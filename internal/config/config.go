package config

import (
	"fmt"
	"log"

	"github.com/kelseyhightower/envconfig"
)

// Config holds all configuration for the application
type Config struct {
	TelegramToken string `envconfig:"TELEGRAM_TOKEN" required:"true"`
	YDBConfig
}

// YDBConfig holds configuration for YDB connection
type YDBConfig struct {
	Endpoint string `envconfig:"YDB_ENDPOINT" required:"true"`
	Database string `envconfig:"YDB_DATABASE" required:"true"`
}

// LoadConfig loads configuration from environment variables
func LoadConfig(appName string) (*Config, error) {
	var cfg Config
	err := envconfig.Process(appName, &cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to process envconfig: %w", err)
	}

	log.Println("Configuration loaded successfully")
	return &cfg, nil
}
