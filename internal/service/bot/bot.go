package bot

import (
	"fmt"
	"strings"

	"github.com/GitH3ll/Marksman/internal/repo/warning"
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

type BotService struct {
	bot    *tgbotapi.BotAPI
	driver *warning.Driver
}

func NewBotService(bot *tgbotapi.BotAPI, driver *warning.Driver) *BotService {
	return &BotService{
		bot:    bot,
		driver: driver,
	}
}

func (s *BotService) HandleUpdate(update tgbotapi.Update) error {
	// We're only interested in messages for now
	if update.Message == nil {
		return nil
	}

	// Check if the message is a command
	if !update.Message.IsCommand() {
		return nil
	}

	allowed, err := s.isAdmin(update)
	if err != nil {
		return fmt.Errorf("admin verification failed: %w", err)
	}

	if !allowed {
		return nil
	}

	// Handle different commands
	switch update.Message.Command() {
	case "warn":
		return s.handleWarnCommand(update.Message)
	case "bang":
		return s.handleBangCommand(update.Message)
	case "pardon":
		return s.handlePardonCommand(update.Message)
	case "crimes":
		return s.handleCrimesCommand(update.Message)
	default:
		// Ignore other commands
		return nil
	}
}

func (s *BotService) handleWarnCommand(message *tgbotapi.Message) error {
	// Extract the reason from the message text
	// Command format: /warn @username reason text
	parts := strings.SplitN(message.Text, " ", 3)
	if len(parts) < 3 {
		msg := tgbotapi.NewMessage(message.Chat.ID, "Usage: /warn @username reason")
		_, err := s.bot.Send(msg)
		return err
	}

	// The target username is the second part (remove @ if present)
	targetUsername := strings.TrimPrefix(parts[1], "@")
	reason := parts[2]

	// In a real implementation, you'd need to resolve the username to a user ID
	// For now, we'll just send a response
	response := fmt.Sprintf("Warning @%s: %s", targetUsername, reason)
	msg := tgbotapi.NewMessage(message.Chat.ID, response)
	_, err := s.bot.Send(msg)
	return err
}

// handleBangCommand implements ban user functionality. For a valid response the message has to adhere to one of the two formats:
// 1 - /bang @id {reason} - default
// 2 - /bang reason - has to be a reply from which userID can be extracted. If a reply, must also delete the message to which it replies.
func (s *BotService) handleBangCommand(message *tgbotapi.Message) error {
	// Check if the command is used in reply to another message
	if message.ReplyToMessage == nil {
		msg := tgbotapi.NewMessage(message.Chat.ID, "Please reply to the user's message to ban them")
		_, err := s.bot.Send(msg)
		return err
	}

	// Get the user to ban from the replied message
	targetUserID := message.ReplyToMessage.From.ID

	// Extract reason
	parts := strings.SplitN(message.Text, " ", 2)
	reason := "No reason provided"
	if len(parts) >= 2 {
		reason = parts[1]
	}

	// Ban the user
	banConfig := tgbotapi.BanChatMemberConfig{
		ChatMemberConfig: tgbotapi.ChatMemberConfig{
			ChatID: message.Chat.ID,
			UserID: targetUserID,
		},
		RevokeMessages: true,
	}

	_, err := s.bot.Request(banConfig)
	if err != nil {
		errorMsg := fmt.Sprintf("Failed to ban user: %v", err)
		msg := tgbotapi.NewMessage(message.Chat.ID, errorMsg)
		s.bot.Send(msg)
		return err
	}

	// Send confirmation message
	response := fmt.Sprintf("User @%s has been banned. Reason: %s", message.ReplyToMessage.From.UserName, reason)
	msg := tgbotapi.NewMessage(message.Chat.ID, response)
	_, err = s.bot.Send(msg)
	return err
}

func (s *BotService) handlePardonCommand(message *tgbotapi.Message) error {
	// Remove warnings for a user
	parts := strings.SplitN(message.Text, " ", 2)
	if len(parts) < 2 {
		msg := tgbotapi.NewMessage(message.Chat.ID, "Usage: /pardon @username")
		_, err := s.bot.Send(msg)
		return err
	}

	targetUsername := strings.TrimPrefix(parts[1], "@")

	response := fmt.Sprintf("Pardoned @%s", targetUsername)
	msg := tgbotapi.NewMessage(message.Chat.ID, response)
	_, err := s.bot.Send(msg)
	return err
}

func (s *BotService) isAdmin(update tgbotapi.Update) (bool, error) {
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

	admins, err := s.bot.GetChatAdministrators(chatConfig)
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

func (s *BotService) handleCrimesCommand(message *tgbotapi.Message) error {
	// List warnings for a user
	parts := strings.SplitN(message.Text, " ", 2)
	if len(parts) < 2 {
		msg := tgbotapi.NewMessage(message.Chat.ID, "Usage: /crimes @username")
		_, err := s.bot.Send(msg)
		return err
	}

	targetUsername := strings.TrimPrefix(parts[1], "@")

	response := fmt.Sprintf("Crimes for @%s: ...", targetUsername)
	msg := tgbotapi.NewMessage(message.Chat.ID, response)
	_, err := s.bot.Send(msg)
	return err
}
