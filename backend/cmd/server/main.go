// Command server boots the Khaao backend: loads config, opens the
// database, seeds it, wires services and routes, starts the expiry ticker,
// and serves HTTP until interrupted.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"khaao/internal/config"
	"khaao/internal/database"
	"khaao/internal/realtime"
	"khaao/internal/routes"
	"khaao/internal/services"
)

func main() {
	cfg := config.Load()

	db, err := database.Open(cfg)
	if err != nil {
		log.Fatalf("khaao: failed to open database: %v", err)
	}
	if err := database.Seed(db, cfg); err != nil {
		log.Fatalf("khaao: failed to seed database: %v", err)
	}

	hub := realtime.NewHub()
	authSvc := services.NewAuthService(db, cfg)
	menuSvc := services.NewMenuService(db, hub)
	engine := services.NewEngine(db, hub, cfg)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go runExpiryTicker(ctx, engine)

	router := routes.Setup(cfg, authSvc, menuSvc, engine, hub)
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	go func() {
		log.Printf("khaao: listening on :%s (driver=%s)", cfg.Port, cfg.DBDriver)
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
func runExpiryTicker(ctx context.Context, engine *services.Engine) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := engine.ExpiryTick(); err != nil {
				log.Printf("khaao: expiry tick error: %v", err)
			}
		}
	}
}
