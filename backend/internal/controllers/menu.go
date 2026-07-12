package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"khaao/internal/services"
)

// MenuController handles the public menu read and the shopkeeper's menu CRUD.
type MenuController struct {
	menu *services.MenuService
}

// NewMenuController builds a MenuController.
func NewMenuController(menu *services.MenuService) *MenuController {
	return &MenuController{menu: menu}
}

// ListAvailable handles GET /api/menu (students: is_available items only).
func (mc *MenuController) ListAvailable(c *gin.Context) {
	items, err := mc.menu.ListAvailable()
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// ListAll handles GET /api/shop/menu (shop: every item).
func (mc *MenuController) ListAll(c *gin.Context) {
	items, err := mc.menu.ListAll()
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// Create handles POST /api/shop/menu.
func (mc *MenuController) Create(c *gin.Context) {
	var req services.MenuItemInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	item, err := mc.menu.Create(req)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"item": item})
}

// Update handles PUT /api/shop/menu/:id.
func (mc *MenuController) Update(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req services.MenuItemInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	item, err := mc.menu.Update(id, req)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"item": item})
}

// Delete handles DELETE /api/shop/menu/:id.
func (mc *MenuController) Delete(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := mc.menu.Delete(id); err != nil {
		respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type stockRequest struct {
	OutOfStock bool `json:"out_of_stock"`
}

// SetStock handles POST /api/shop/menu/:id/stock.
func (mc *MenuController) SetStock(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req stockRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	item, err := mc.menu.SetStock(id, req.OutOfStock)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"item": item})
}
