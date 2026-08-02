package controllers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"khaao/internal/config"
)

func TestGetCloudinarySignatureRejectsMissingConfiguration(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name string
		cfg  *config.Config
	}{
		{"missing everything", &config.Config{}},
		{"missing API secret", &config.Config{CloudinaryCloudName: "demo", CloudinaryAPIKey: "key"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/api/shop/menu/photo-signature", nil)

			GetCloudinarySignature(tt.cfg)(ctx)

			if recorder.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
			}
		})
	}
}

func TestGetCloudinarySignatureReturnsUploadParameters(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/shop/menu/photo-signature", nil)

	GetCloudinarySignature(&config.Config{
		CloudinaryCloudName: "demo",
		CloudinaryAPIKey:    "key",
		CloudinaryAPISecret: "secret",
	})(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
}
