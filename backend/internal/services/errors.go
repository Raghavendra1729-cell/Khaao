package services

// AppError is a service-level error carrying the HTTP status the controller
// layer should respond with. Services never import net/http themselves;
// they just pick the right numeric status so controllers can respond with
// {"error": message} directly.
type AppError struct {
	Status  int
	Message string
}

func (e *AppError) Error() string { return e.Message }

// NewError builds an AppError.
func NewError(status int, message string) *AppError {
	return &AppError{Status: status, Message: message}
}

var (
	ErrBadRequest   = func(msg string) *AppError { return NewError(400, msg) }
	ErrUnauthorized = func(msg string) *AppError { return NewError(401, msg) }
	ErrForbidden    = func(msg string) *AppError { return NewError(403, msg) }
	ErrNotFound     = func(msg string) *AppError { return NewError(404, msg) }
	ErrConflict     = func(msg string) *AppError { return NewError(409, msg) }
	ErrUnorderable  = func(msg string) *AppError { return NewError(422, msg) }
	ErrInternal     = func(msg string) *AppError { return NewError(500, msg) }
)
