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
	poolEngine *services.PoolEngine,
	hub *realtime.Hub,
) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.CORS(cfg))
	r.Use(middleware.MaxBodyBytes(1 << 20)) // 1 MiB request-body cap

	authCtrl := controllers.NewAuthController(authSvc)
	menuCtrl := controllers.NewMenuController(menuSvc)
	orderCtrl := controllers.NewOrderController(orderSvc, poolEngine, hub)
	shopCtrl := controllers.NewShopController(orderSvc, poolEngine, hub, cfg)

	requireAuth := middleware.RequireAuth(cfg, authSvc)
	requireStudent := middleware.RequireRole(string(models.RoleStudent))
	requireShopkeeper := middleware.RequireRole(string(models.RoleShopkeeper))

	api := r.Group("/api")

	// The live menu is public — students can browse before signing in.
	api.GET("/menu", menuCtrl.ListAvailable)

	auth := api.Group("/auth")
	{
		auth.GET("/config", authCtrl.Config)
		auth.POST("/firebase", authCtrl.Firebase)
		auth.GET("/me", requireAuth, authCtrl.Me)
	}

	// Student-facing routes (authenticated + student role).
	student := api.Group("")
	student.Use(requireAuth, requireStudent)
	{
		student.POST("/orders", orderCtrl.Create)
		student.GET("/orders/active", orderCtrl.Active)
		student.GET("/orders", orderCtrl.History)
		student.POST("/orders/:id/cancel", orderCtrl.Cancel)
		student.GET("/stream", orderCtrl.Stream)
	}

	// Shopkeeper-only routes.
	shop := api.Group("/shop")
	shop.Use(requireAuth, requireShopkeeper)
	{
		shop.GET("/menu", menuCtrl.ListAll)
		shop.POST("/menu", menuCtrl.Create)
		shop.PUT("/menu/:id", menuCtrl.Update)
		shop.DELETE("/menu/:id", menuCtrl.Delete)
		shop.POST("/menu/:id/stock", menuCtrl.SetStock)

		shop.GET("/orders", shopCtrl.Orders)
		shop.GET("/history", shopCtrl.History)
		shop.POST("/orders/:id/accept", shopCtrl.Accept)
		shop.POST("/orders/:id/reject", shopCtrl.Reject)

		shop.GET("/prep", shopCtrl.Prep)
		shop.POST("/prep/:menu_item_id/done", shopCtrl.Done)

		shop.POST("/orders/:id/items/:itemID/handover", shopCtrl.Handover)
		shop.DELETE("/orders/:id/items/:itemID", shopCtrl.RemoveItem)
		shop.POST("/orders/:id/paid", shopCtrl.Paid)
		shop.POST("/day/close", shopCtrl.CloseDay)

		shop.GET("/stream", shopCtrl.Stream)
	}

	return r
}
