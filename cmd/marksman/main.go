package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/GitH3ll/Marksman/internal/config"
	"github.com/GitH3ll/Marksman/internal/repo/warning"
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/ydb-platform/ydb-go-sdk/v3"
)

var (
	bot    *tgbotapi.BotAPI
	driver *ydb.Driver
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
	bot, err = tgbotapi.NewBotAPI(cfg.TelegramToken)
	if err != nil {
		slog.Error("Failed to create bot", "error", err)
		os.Exit(1)
	}
	slog.Info("Authorized on account", "username", bot.Self.UserName)

	// Initialize YDB driver
	ctx := context.Background()
	driver, err = warning.Connect(ctx, cfg.YDBConfig)
	if err != nil {
		slog.Error("Failed to connect to YDB", "error", err)
		os.Exit(1)
	}
	slog.Info("Connected to YDB successfully")
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
	if err := handleUpdate(update); err != nil {
		slog.Error("Error handling update", "error", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func handleUpdate(update tgbotapi.Update) error {
	// We're only interested in messages for now
	if update.Message == nil {
		return nil
	}

	// Check if the message is a command
	if !update.Message.IsCommand() {
		return nil
	}

	allowed, err := isAdmin(update)
	if err != nil {
		return fmt.Errorf("admin verification failed: %w", err)
	}

	if !allowed {
		return nil
	}

	// Handle different commands
	switch update.Message.Command() {
	case "warn":
		return handleWarnCommand(update.Message)
	case "bang":
		return handleBangCommand(update.Message)
	case "pardon":
		return handlePardonCommand(update.Message)
	case "crimes":
		return handleCrimesCommand(update.Message)
	default:
		// Ignore other commands
		return nil
	}
}

func handleWarnCommand(message *tgbotapi.Message) error {
	// Extract the reason from the message text
	// Command format: /warn @username reason text
	parts := strings.SplitN(message.Text, " ", 3)
	if len(parts) < 3 {
		msg := tgbotapi.NewMessage(message.Chat.ID, "Usage: /warn @username reason")
		_, err := bot.Send(msg)
		return err
	}

	// The target username is the second part (remove @ if present)
	targetUsername := strings.TrimPrefix(parts[1], "@")
	reason := parts[2]

	// In a real implementation, you'd need to resolve the username to a user ID
	// For now, we'll just send a response
	response := fmt.Sprintf("Warning @%s: %s", targetUsername, reason)
	msg := tgbotapi.NewMessage(message.Chat.ID, response)
	_, err := bot.Send(msg)
	return err
}

func handleBangCommand(message *tgbotapi.Message) error {
	// Similar to warn but with different action
	parts := strings.SplitN(message.Text, " ", 3)
	if len(parts) < 3 {
		msg := tgbotapi.NewMessage(message.Chat.ID, "Usage: /bang @username reason")
		_, err := bot.Send(msg)
		return err
	}

	targetUsername := strings.TrimPrefix(parts[1], "@")
	reason := parts[2]

	response := fmt.Sprintf("Banged @%s: %s", targetUsername, reason)
	msg := tgbotapi.NewMessage(message.Chat.ID, response)
	_, err := bot.Send(msg)
	return err
}

func handlePardonCommand(message *tgbotapi.Message) error {
	// Remove warnings for a user
	parts := strings.SplitN(message.Text, " ", 2)
	if len(parts) < 2 {
		msg := tgbotapi.NewMessage(message.Chat.ID, "Usage: /pardon @username")
		_, err := bot.Send(msg)
		return err
	}

	targetUsername := strings.TrimPrefix(parts[1], "@")

	response := fmt.Sprintf("Pardoned @%s", targetUsername)
	msg := tgbotapi.NewMessage(message.Chat.ID, response)
	_, err := bot.Send(msg)
	return err
}

func isAdmin(update tgbotapi.Update) (bool, error) {
	// Check if the message is from a group chat
	if update.Message.Chat.IsPrivate() {
		return false, nil
	}

	// Get chat administrators
	chatConfig := tgbotapi.ChatAdministratorsConfig{
		ChatConfig: tgbotapi.ChatConfig{
			ChatID: update.Message.Chat.ID,
		},
	}

	admins, err := bot.GetChatAdministrators(chatConfig)
	if err != nil {
		return false, fmt.Errorf("failed to get chat administrators: %w", err)
	}

	// Check if the sender is among the administrators
	for _, admin := range admins {
		if admin.User.ID == update.Message.From.ID {
			// Check if the admin has the can_restrict_members permission
			// Note: Some fields might be nil, so we need to handle that
			if admin.CanRestrictMembers {
				return true, nil
			}
			// For supergroup admins, the status might indicate they're the creator who has all permissions
			if admin.Status == "creator" {
				return true, nil
			}
		}
	}

	return false, nil
}

func handleCrimesCommand(message *tgbotapi.Message) error {
	// List warnings for a user
	parts := strings.SplitN(message.Text, " ", 2)
	if len(parts) < 2 {
		msg := tgbotapi.NewMessage(message.Chat.ID, "Usage: /crimes @username")
		_, err := bot.Send(msg)
		return err
	}

	targetUsername := strings.TrimPrefix(parts[1], "@")

	response := fmt.Sprintf("Crimes for @%s: ...", targetUsername)
	msg := tgbotapi.NewMessage(message.Chat.ID, response)
	_, err := bot.Send(msg)
	return err
}

func main() {
	// This is just for local testing, Yandex Cloud Function will call Handler directly
	// For local testing, we can run a simple HTTP server
	if os.Getenv("YC_HANDLER") != "true" {
		defer driver.Close(context.Background())
		
		// Start the HTTP server for local testing
		http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			// Parse the update from Telegram
			var update tgbotapi.Update
			if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
				slog.Error("Error decoding update", "error", err)
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}

			// Handle the update
			if err := handleUpdate(update); err != nil {
				slog.Error("Error handling update", "error", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusOK)
		})

		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}

		slog.Info("Starting local test server", "port", port)
		slog.Error("Server exited", "error", http.ListenAndServe(":"+port, nil))
	}
}
