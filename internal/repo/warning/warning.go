package warning

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/ydb-platform/ydb-go-sdk/v3"
	yc "github.com/ydb-platform/ydb-go-yc" // For automatic auth in Yandex Cloud
)

// YDBConfig holds configuration for YDB connection
type YDBConfig struct {
	Endpoint string
	Database string
}

// YDBConnection represents a connection to YDB
type YDBConnection struct {
	driver *ydb.Driver
	config *YDBConfig
}

// NewYDBConnection creates a new YDB connection instance
func NewYDBConnection(config *YDBConfig) *YDBConnection {
	return &YDBConnection{
		config: config,
	}
}

// Connect establishes a connection to YDB using automatic authentication in Yandex Cloud
func (c *YDBConnection) Connect(ctx context.Context) error {
	// In Yandex Cloud Function, we can use yc.WithMetadataCredentials which automatically
	// gets the appropriate token from the metadata service
	opts := []ydb.Option{
		yc.WithMetadataCredentials(ctx), // This handles authentication automatically
		ydb.WithDialTimeout(10 * time.Second),
		ydb.WithSessionPoolSizeLimit(10),
	}
	
	// Create the driver
	driver, err := ydb.Open(ctx,
		fmt.Sprintf("grpcs://%s/%s", c.config.Endpoint, c.config.Database),
		opts...,
	)
	if err != nil {
		return fmt.Errorf("failed to connect to YDB: %w", err)
	}
	
	c.driver = driver
	log.Println("Successfully connected to YDB")
	return nil
}

// Close closes the YDB connection
func (c *YDBConnection) Close(ctx context.Context) error {
	if c.driver != nil {
		return c.driver.Close(ctx)
	}
	return nil
}

// Driver returns the underlying YDB driver
func (c *YDBConnection) Driver() *ydb.Driver {
	return c.driver
}

// HealthCheck performs a basic health check on the connection
func (c *YDBConnection) HealthCheck(ctx context.Context) error {
	if c.driver == nil {
		return fmt.Errorf("driver is not initialized")
	}
	
	// Check if the connection is alive by getting the current time from the database
	var currentTime time.Time
	err := c.driver.Table().Do(ctx, func(ctx context.Context, s ydb.Table.Session) error {
		_, res, err := s.Execute(ctx, ydb.Table.DefaultTxControl(), "SELECT CurrentUtcTimestamp()", nil)
		if err != nil {
			return err
		}
		defer res.Close()
		if !res.NextResultSet(ctx) || !res.NextRow() {
			return fmt.Errorf("no rows returned")
		}
		return res.Scan(&currentTime)
	})
	
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	
	log.Printf("Health check passed. Current database time: %v", currentTime)
	return nil
}

// GetConnection returns the YDB driver which can be used to execute queries
// This is useful for the actual handler to use
func (c *YDBConnection) GetConnection() *ydb.Driver {
	return c.driver
}
