package warning

import (
	"context"
	"fmt"
	"time"

	"github.com/GitH3ll/Marksman/internal/config"
	"github.com/google/uuid"
	"github.com/ydb-platform/ydb-go-sdk/v3"
	"github.com/ydb-platform/ydb-go-sdk/v3/table"
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
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	ChatID    string    `json:"chat_id"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateWarning inserts a new warning into the warnings table
func CreateWarning(ctx context.Context, driver *ydb.Driver, userID, chatID, reason string) error {
	// Generate a UUID for the warning
	warningID := uuid.New().String()
	
	// Prepare the query
	query := `
		DECLARE $id AS Utf8;
		DECLARE $user_id AS Utf8;
		DECLARE $chat_id AS Utf8;
		DECLARE $reason AS Utf8;
		DECLARE $created_at AS Timestamp;
		
		INSERT INTO warnings (id, user_id, chat_id, reason, created_at)
		VALUES ($id, $user_id, $chat_id, $reason, $created_at);
	`
	
	// Execute the query
	return driver.Table().Do(ctx, func(ctx context.Context, session table.Session) error {
		_, _, err := session.Execute(ctx, table.DefaultTxControl(), query,
			table.NewQueryParameters(
				table.ValueParam("$id", named.UTF8Value(warningID)),
				table.ValueParam("$user_id", named.UTF8Value(userID)),
				table.ValueParam("$chat_id", named.UTF8Value(chatID)),
				table.ValueParam("$reason", named.UTF8Value(reason)),
				table.ValueParam("$created_at", named.TimestampValueFromTime(time.Now())),
			),
		)
		if err != nil {
			return fmt.Errorf("failed to execute query: %w", err)
		}
		return nil
	})
}
