package warning

import (
	"context"
	"fmt"

	"github.com/GitH3ll/Marksman/internal/config"
	"github.com/google/uuid"
	"github.com/ydb-platform/ydb-go-sdk/v3"
	"github.com/ydb-platform/ydb-go-sdk/v3/table"
	"github.com/ydb-platform/ydb-go-sdk/v3/table/types"
	"github.com/ydb-platform/ydb-go-sdk/v3/table/result/named"
	yc "github.com/ydb-platform/ydb-go-yc"
)

func Connect(ctx context.Context, config config.YDBConfig) (*ydb.Driver, error) {
	return ydb.Open(ctx,
		config.Endpoint,
		yc.WithInternalCA(),
		yc.WithMetadataCredentials(),
	)
}

// Warning represents a warning entry in the database
type Warning struct {
	ID     string `json:"id"`
	UserID string `json:"user_id"`
	ChatID string `json:"chat_id"`
	Reason string `json:"reason"`
}

// CreateWarning inserts a new warning into the warnings table
func CreateWarning(ctx context.Context, driver *ydb.Driver, userID, chatID, reason string) error {
	// Generate a UUID for the warning
	warningID := uuid.New()

	// Prepare the query
	query := `
		DECLARE $id AS Utf8;
		DECLARE $user_id AS Utf8;
		DECLARE $chat_id AS Utf8;
		DECLARE $reason AS Utf8;
		
		INSERT INTO warnings (id, user_id, chat_id, reason)
		VALUES ($id, $user_id, $chat_id, $reason);
	`

	// Execute the query
	return driver.Table().Do(ctx, func(ctx context.Context, session table.Session) error {
		_, _, err := session.Execute(ctx, table.DefaultTxControl(), query,
			table.NewQueryParameters(
				table.ValueParam("$id", types.UuidValue(warningID)),
				table.ValueParam("$user_id", types.UTF8Value(userID)),
				table.ValueParam("$chat_id", types.UTF8Value(chatID)),
				table.ValueParam("$reason", types.UTF8Value(reason)),
			),
		)
		if err != nil {
			return fmt.Errorf("failed to execute query: %w", err)
		}
		return nil
	})
}

// GetWarningsByUserAndChat retrieves all warnings for a specific user in a specific chat
func GetWarningsByUserAndChat(ctx context.Context, driver *ydb.Driver, userID, chatID string) ([]Warning, error) {
	// Prepare the query
	query := `
		DECLARE $user_id AS Utf8;
		DECLARE $chat_id AS Utf8;
		
		SELECT id, user_id, chat_id, reason
		FROM warnings 
		WHERE user_id = $user_id AND chat_id = $chat_id;
	`

	var warnings []Warning
	
	// Execute the query
	err := driver.Table().Do(ctx, func(ctx context.Context, session table.Session) error {
		_, res, err := session.Execute(ctx, table.DefaultTxControl(), query,
			table.NewQueryParameters(
				table.ValueParam("$user_id", types.UTF8Value(userID)),
				table.ValueParam("$chat_id", types.UTF8Value(chatID)),
			),
		)
		if err != nil {
			return fmt.Errorf("failed to execute query: %w", err)
		}
		defer res.Close()
		
		// Scan the results
		for res.NextResultSet(ctx) {
			for res.NextRow() {
				var warning Warning
				err := res.ScanNamed(
					named.Optional("id", &warning.ID),
					named.Optional("user_id", &warning.UserID),
					named.Optional("chat_id", &warning.ChatID),
					named.Optional("reason", &warning.Reason),
				)
				if err != nil {
					return fmt.Errorf("failed to scan row: %w", err)
				}
				warnings = append(warnings, warning)
			}
		}
		return res.Err()
	})
	
	if err != nil {
		return nil, err
	}
	
	return warnings, nil
}
