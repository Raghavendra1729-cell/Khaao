package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"khaao/internal/services"
)

type MenuController struct {
	menu *services.MenuService
}

func NewMenuController(menu *services.MenuService) *MenuController {
	return &MenuController{menu: menu}
}

func (mc *MenuController) ListAvailable(c *gin.Context) {
	items, err := mc.menu.ListAvailable(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (mc *MenuController) ListAll(c *gin.Context) {
	items, err := mc.menu.ListAll(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (mc *MenuController) Create(c *gin.Context) {
	var req services.MenuItemInput
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	item, err := mc.menu.Create(c.Request.Context(), req)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"item": item})
}

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
	item, err := mc.menu.Update(c.Request.Context(), id, req)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"item": item})
}

func (mc *MenuController) Delete(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := mc.menu.Delete(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type stockRequest struct {
	OutOfStock bool `json:"out_of_stock"`
}

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
	item, err := mc.menu.SetStock(c.Request.Context(), id, req.OutOfStock)
	if err != nil {
		respondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"item": item})
}
