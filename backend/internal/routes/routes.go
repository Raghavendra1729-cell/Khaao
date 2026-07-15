package routes

import (
	"github.com/gin-gonic/gin"

	"khaao/internal/config"
	"khaao/internal/controllers"
	"khaao/internal/middleware"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/services"
)

// Setup builds the Gin engine with all middleware and routes registered.
func Setup(
	cfg *config.Config,
	authSvc *services.AuthService,
	menuSvc *services.MenuService,
	orderSvc *services.OrderService,
	shopStatusSvc *services.ShopStatusService,
	ratingsSvc *services.RatingsService,
	poolEngine *services.PoolEngine,
	pushSvc *services.PushService,
	ssTicketSvc *services.SSETicketService,
	hub *realtime.Hub,
) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.CORS(cfg))
	r.Use(middleware.MaxBodyBytes(1 << 20)) // 1 MiB request-body cap

	authCtrl := controllers.NewAuthController(authSvc, ssTicketSvc)
	menuCtrl := controllers.NewMenuController(menuSvc)
	orderCtrl := controllers.NewOrderController(orderSvc, poolEngine, ratingsSvc, hub)
	shopCtrl := controllers.NewShopController(orderSvc, poolEngine, hub, cfg)
	shopStatusCtrl := controllers.NewShopStatusController(shopStatusSvc)
	pushCtrl := controllers.NewPushController(cfg, pushSvc)

	requireAuth := middleware.RequireAuth(cfg, authSvc)
	requireSSEAuth := middleware.RequireSSEAuth(authSvc, ssTicketSvc)
	requireStudent := middleware.RequireRole(string(models.RoleStudent))
	requireShopkeeper := middleware.RequireRole(string(models.RoleShopkeeper))

	// P1-c: per-user rate limiting on mutations, and a per-user cap on
	// concurrent SSE connections. Both are in-memory and keyed by user id —
	// see middleware/ratelimit.go for the numbers and the reasoning.
	rateLimiter := middleware.NewRateLimiter()
	rateLimit := middleware.RateLimitByUser(rateLimiter)
	sseConnLimiter := middleware.NewSSEConnectionLimiter()
	limitSSEConns := middleware.LimitConcurrentSSE(sseConnLimiter)

	api := r.Group("/api")

	// Liveness probe — no auth required.
	api.GET("/health", controllers.Health)

	// The live menu is public — students can browse before signing in.
	api.GET("/menu", menuCtrl.ListAvailable)

	// The shop's open/paused/closed status is public so the student menu can
	// show a closed/on-a-break banner without authenticating.
	api.GET("/shop-status", shopStatusCtrl.Get)

	auth := api.Group("/auth")
	{
		auth.GET("/config", authCtrl.Config)
		auth.POST("/firebase", authCtrl.Firebase)
		auth.GET("/me", requireAuth, authCtrl.Me)
		// Mints the short-lived ticket the frontend exchanges for SSE access
		// (see requireSSEAuth below) — authenticated the normal way, via the
		// Bearer JWT, so the real token never has to appear in a URL.
		auth.POST("/sse-ticket", requireAuth, rateLimit, authCtrl.SSETicket)
	}

	push := api.Group("/push")
	{
		push.GET("/vapid-public-key", pushCtrl.GetVapidPublicKey)
		push.POST("/subscribe", requireAuth, rateLimit, pushCtrl.Subscribe)
	}

	// Student-facing routes (authenticated + student role).
	student := api.Group("")
	student.Use(requireAuth, requireStudent, rateLimit)
	{
		student.POST("/orders", orderCtrl.Create)
		student.GET("/orders/active", orderCtrl.Active)
		student.GET("/orders", orderCtrl.History)
		student.POST("/orders/:id/cancel", orderCtrl.Cancel)
		student.POST("/orders/:id/ratings", orderCtrl.Rate)
	}
	// The student SSE stream authenticates via a one-use ticket instead of
	// the JWT (P1-b) and is capped per-user (P1-c), so it's registered
	// standalone rather than inside the `student` group above, which uses
	// JWT-based requireAuth for its (rate-limited) mutation routes.
	api.GET("/stream", requireSSEAuth, requireStudent, limitSSEConns, orderCtrl.Stream)

	// Shopkeeper-only routes.
	shop := api.Group("/shop")
	shop.Use(requireAuth, requireShopkeeper, rateLimit)
	{
		shop.GET("/menu", menuCtrl.ListAll)
		shop.POST("/menu", menuCtrl.Create)
		shop.PUT("/menu/:id", menuCtrl.Update)
		shop.DELETE("/menu/:id", menuCtrl.Delete)
		shop.POST("/menu/:id/stock", menuCtrl.SetStock)
		shop.POST("/menu/photo-signature", controllers.GetCloudinarySignature(cfg))

		shop.GET("/orders", shopCtrl.Orders)
		shop.GET("/history", shopCtrl.History)
		shop.POST("/orders/:id/accept", shopCtrl.Accept)
		shop.POST("/orders/:id/reject", shopCtrl.Reject)

		shop.GET("/prep", shopCtrl.Prep)
		shop.POST("/prep/:menu_item_id/done", shopCtrl.Done)

		shop.POST("/orders/:id/items/:itemID/handover", shopCtrl.Handover)
		shop.DELETE("/orders/:id/items/:itemID", shopCtrl.RemoveItem)
		shop.POST("/orders/:id/paid", shopCtrl.Paid)

		shop.POST("/status", shopStatusCtrl.Set)
	}
	// Same reasoning as the student stream above: ticket-authenticated,
	// per-user connection-capped, registered outside the JWT-based `shop`
	// group.
	api.GET("/shop/stream", requireSSEAuth, requireShopkeeper, limitSSEConns, shopCtrl.Stream)

	return r
}
