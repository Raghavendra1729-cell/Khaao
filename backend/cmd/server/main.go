package main

import (
	"context"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"khaao/internal/authn"
	"khaao/internal/config"
	"khaao/internal/database"
	"khaao/internal/realtime"
	"khaao/internal/repository"
	"khaao/internal/routes"
	"khaao/internal/services"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("khaao: invalid configuration: %v", err)
	}

	initLogger(cfg.AppEnv)

	// Gin defaults to debug mode (verbose route-registration logging, and
	// its own startup banner warning exactly about this) unless told
	// otherwise. Anything other than local dev/test should run in
	// ReleaseMode — quieter logs (ours are the structured slog lines
	// above, not Gin's own [GIN-debug] ones) and Gin skips some
	// debug-only internal checks on every request.
	if cfg.AppEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	db, err := database.Open(cfg)
	if err != nil {
		log.Fatalf("khaao: failed to open database: %v", err)
	}
	if err := database.Seed(db, cfg); err != nil {
		log.Fatalf("khaao: failed to seed database: %v", err)
	}

	hub := realtime.NewHub()

	uow := repository.NewUnitOfWork(db)
	userRepo := repository.NewUserRepo(db)
	orderRepo := repository.NewOrderRepo(db)
	menuRepo := repository.NewMenuRepo(db)
	poolRepo := repository.NewPoolRepo(db)
	eventRepo := repository.NewEventRepo(db)
	emailRepo := repository.NewShopkeeperEmailRepo(db)
	shopStatusRepo := repository.NewShopStatusRepo(db)
	ratingRepo := repository.NewRatingRepo(db)
	pushRepo := repository.NewPushRepo(db)

	var tokenVerifier authn.TokenVerifier
	if cfg.AuthFake {
		// Validate() already guarantees AppEnv is dev/test here.
		slog.Warn("khaao: AUTH_FAKE enabled — \"fake:<email>\" tokens are accepted (dev/e2e only)")
		tokenVerifier = authn.NewFakeVerifier()
	} else {
		tokenVerifier = authn.NewFirebaseVerifier(cfg.FirebaseProjectID)
	}

	authSvc := services.NewAuthService(userRepo, emailRepo, tokenVerifier, cfg)
	menuSvc := services.NewMenuService(menuRepo, orderRepo, ratingRepo, hub, cfg)
	orderSvc := services.NewOrderService(orderRepo)
	shopStatusSvc := services.NewShopStatusService(shopStatusRepo, orderRepo, uow, hub)
	ratingsSvc := services.NewRatingsService(ratingRepo, orderRepo)
	pushSvc := services.NewPushService(cfg, pushRepo)
	ssTicketSvc := services.NewSSETicketService()
	alloc := &services.FCFSAllocation{}
	poolEngine := services.NewPoolEngine(uow, orderRepo, menuRepo, poolRepo, eventRepo, shopStatusRepo, hub, cfg, alloc)
	// Wire poolEngine into shopStatusSvc so Set() can auto-reject submitted
	// orders when the shop transitions to paused/closed (Fix 2).
	shopStatusSvc.SetPool(poolEngine)
	poolEngine.SetPushService(pushSvc)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go runExpiryTicker(ctx, poolEngine)

	router := routes.Setup(cfg, authSvc, menuSvc, orderSvc, shopStatusSvc, ratingsSvc, poolEngine, pushSvc, ssTicketSvc, hub)
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second, // slowloris protection
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
		// WriteTimeout intentionally unset: SSE streams are long-lived.
	}

	go func() {
		slog.Info("khaao: listening", "port", cfg.Port, "db", "postgres")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("khaao: server error: %v", err)
		}
	}()

	<-ctx.Done()
	slog.Info("khaao: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("khaao: graceful shutdown error", "error", err)
	}
}

// initLogger sets the process-wide slog default: JSON in production (for log
// aggregators), human-readable text elsewhere. Called once at startup before
// anything else logs.
func initLogger(appEnv string) {
	var handler slog.Handler
	if appEnv == "production" {
		handler = slog.NewJSONHandler(os.Stdout, nil)
	} else {
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})
	}
	slog.SetDefault(slog.New(handler))
}

// runExpiryTicker expires ready orders past their hold window every 15s.
func runExpiryTicker(ctx context.Context, engine *services.PoolEngine) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := engine.ExpiryTick(ctx); err != nil {
				slog.Error("khaao: expiry tick failed", "error", err)
			}
		}
	}
}
