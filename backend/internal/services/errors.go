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

func ErrBadRequest(msg string) *AppError   { return NewError(400, msg) }
func ErrUnauthorized(msg string) *AppError { return NewError(401, msg) }
func ErrForbidden(msg string) *AppError    { return NewError(403, msg) }
func ErrNotFound(msg string) *AppError     { return NewError(404, msg) }
func ErrConflict(msg string) *AppError     { return NewError(409, msg) }
func ErrUnorderable(msg string) *AppError  { return NewError(422, msg) }
func ErrInternal(msg string) *AppError     { return NewError(500, msg) }
