package warning

import (
	"context"

	"github.com/GitH3ll/Marksman/internal/config"
	"github.com/ydb-platform/ydb-go-sdk/v3"
	yc "github.com/ydb-platform/ydb-go-yc"
)

func Connect(ctx context.Context, config config.YDBConfig) (*ydb.Driver, error) {
	return ydb.Open(ctx,
		config.Endpoint,
		yc.WithInternalCA(),
		yc.WithMetadataCredentials(),
	)
}
