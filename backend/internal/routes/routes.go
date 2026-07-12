// Package routes registers every endpoint in SPEC.md's API contract onto a
// Gin engine.
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
	engine *services.Engine,
	hub *realtime.Hub,
) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.CORS(cfg))

	authCtrl := controllers.NewAuthController(authSvc)
	menuCtrl := controllers.NewMenuController(menuSvc)
	orderCtrl := controllers.NewOrderController(engine, hub)
	shopCtrl := controllers.NewShopController(engine, hub)

	requireAuth := middleware.RequireAuth(cfg)
	requireShopkeeper := middleware.RequireRole(string(models.RoleShopkeeper))

	api := r.Group("/api")

	auth := api.Group("/auth")
	{
		auth.GET("/config", authCtrl.Config)
		auth.POST("/signup", authCtrl.Signup)
		auth.POST("/login", authCtrl.Login)
		auth.POST("/google", authCtrl.Google)
		auth.POST("/guest", authCtrl.Guest)
		auth.GET("/me", requireAuth, authCtrl.Me)
	}

	// Student-facing routes (all authenticated).
	student := api.Group("")
	student.Use(requireAuth)
	{
		student.GET("/menu", menuCtrl.ListAvailable)
		student.POST("/orders", orderCtrl.Create)
		student.GET("/orders/active", orderCtrl.Active)
		student.GET("/orders", orderCtrl.History)
		student.POST("/orders/:id/items", orderCtrl.AddItem)
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

		shop.POST("/orders/:id/close", shopCtrl.Close)
		shop.POST("/day/close", shopCtrl.CloseDay)

		shop.GET("/stream", shopCtrl.Stream)
	}

	return r
}
