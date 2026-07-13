package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

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

	var tokenVerifier authn.TokenVerifier
	if cfg.AuthFake {
		// Validate() already guarantees AppEnv is dev/test here.
		log.Println(`khaao: WARNING — AUTH_FAKE enabled; "fake:<email>" tokens are accepted (dev/e2e only)`)
		tokenVerifier = authn.NewFakeVerifier()
	} else {
		tokenVerifier = authn.NewFirebaseVerifier(cfg.FirebaseProjectID)
	}

	authSvc := services.NewAuthService(userRepo, emailRepo, tokenVerifier, cfg)
	menuSvc := services.NewMenuService(menuRepo, hub)
	orderSvc := services.NewOrderService(orderRepo)
	alloc := &services.FCFSAllocation{}
	poolEngine := services.NewPoolEngine(uow, orderRepo, menuRepo, poolRepo, eventRepo, hub, cfg, alloc)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go runExpiryTicker(ctx, poolEngine)

	router := routes.Setup(cfg, authSvc, menuSvc, orderSvc, poolEngine, hub)
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
		log.Printf("khaao: listening on :%s (Postgres)", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("khaao: server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("khaao: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("khaao: graceful shutdown error: %v", err)
	}
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
				log.Printf("khaao: expiry tick error: %v", err)
			}
		}
	}
}
