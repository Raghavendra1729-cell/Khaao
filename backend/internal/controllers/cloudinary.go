package controllers

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"khaao/internal/config"
)

type CloudinarySignatureResponse struct {
	Signature string `json:"signature"`
	Timestamp int64  `json:"timestamp"`
	APIKey    string `json:"api_key"`
	CloudName string `json:"cloud_name"`
	Folder    string `json:"folder"`
}

func GetCloudinarySignature(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		timestamp := time.Now().Unix()
		folder := "khaao-menu"

		// Cloudinary requires parameters to be alphabetically sorted.
		// "folder" comes before "timestamp"
		paramStr := fmt.Sprintf("folder=%s&timestamp=%d", folder, timestamp)
		signatureStr := paramStr + cfg.CloudinaryAPISecret

		hasher := sha1.New()
		hasher.Write([]byte(signatureStr))
		signature := hex.EncodeToString(hasher.Sum(nil))

		c.JSON(http.StatusOK, CloudinarySignatureResponse{
			Signature: signature,
			Timestamp: timestamp,
			APIKey:    cfg.CloudinaryAPIKey,
			CloudName: cfg.CloudinaryCloudName,
			Folder:    folder,
		})
	}
}
