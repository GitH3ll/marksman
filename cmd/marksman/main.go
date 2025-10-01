package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"

	"github.com/GitH3ll/Marksman/internal/config"
	"github.com/GitH3ll/Marksman/internal/repo/warning"
	"github.com/GitH3ll/Marksman/internal/service/bot"
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

var (
	botService *bot.BotService
)

func init() {
	// Set up structured logging
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	// Load configuration
	cfg, err := config.LoadConfig("marksman")
	if err != nil {
		slog.Error("Failed to load config", "error", err)
		os.Exit(1)
	}

	// Initialize Telegram bot
	telegramBot, err := tgbotapi.NewBotAPI(cfg.TelegramToken)
	if err != nil {
		slog.Error("Failed to create bot", "error", err)
		os.Exit(1)
	}
	slog.Info("Authorized on account", "username", telegramBot.Self.UserName)

	// Initialize YDB driver
	ctx := context.Background()
	driver, err := warning.Connect(ctx, cfg.YDBConfig)
	if err != nil {
		slog.Error("Failed to connect to YDB", "error", err)
		os.Exit(1)
	}
	slog.Info("Connected to YDB successfully")

	// Initialize bot service
	botService = bot.NewBotService(telegramBot, driver)
}

// Handler is the entry point for Yandex Cloud Function
func Handler(w http.ResponseWriter, r *http.Request) {
	// Parse the update from Telegram
	var update tgbotapi.Update
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		slog.Error("Error decoding update", "error", err)
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	// Handle the update
	if err := botService.HandleUpdate(r.Context(), update); err != nil {
		slog.Error("Error handling update", "error", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func main() {
	// This is just for local testing, Yandex Cloud Function will call Handler directly
	// For local testing, we can run a simple HTTP server
	if os.Getenv("YC_HANDLER") != "true" {
		// Note: We need to close the driver, but it's now inside the service
		// We'll need to handle this differently, perhaps by exposing it
		// For now, we'll leave it as is

		// Start the HTTP server for local testing
		http.HandleFunc("/", Handler)

		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}

		slog.Info("Starting local test server", "port", port)
		slog.Error("Server exited", "error", http.ListenAndServe(":"+port, nil))
	}
}
