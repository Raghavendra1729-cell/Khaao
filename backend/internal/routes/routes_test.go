// Package routes_test builds the real routes.Setup engine over in-memory
// fakes and asserts, for every registered route, that the auth/role gating
// is exactly what routes.go's grouping implies. This is the "does the
// middleware chain actually match the route table" test: a route
// accidentally registered on the wrong group (e.g. a shop mutation dropped
// onto the public `api` group instead of the shopkeeper-only `shop` group)
// is a total authorization failure that nothing else in this codebase
// catches today.
//
// Route coverage is driven off router.Routes() (the engine's own registered
// route table), not a hand-typed list: expectedCategory below is a lookup
// keyed by (method, path), and any route Setup registers that isn't a key in
// that map fails the test loudly instead of being silently skipped. That's
// what makes this durable against a future route being added and forgotten.
package routes_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"khaao/internal/authn"
	"khaao/internal/config"
	"khaao/internal/models"
	"khaao/internal/realtime"
	"khaao/internal/repository"
	"khaao/internal/routes"
	"khaao/internal/services"
)

// ---- in-memory fakes -------------------------------------------------------
//
// These mirror the house style in internal/services/pool_test.go and
// wp1_test.go (hand-written maps implementing the repository interfaces),
// duplicated here (rather than imported — services_test's mocks are
// unexported and live in a different package) trimmed to the minimum each
// service constructor needs.

type fakeUoW struct{}

func (f *fakeUoW) WithTx(ctx context.Context, fn func(context.Context) error) error {
	return fn(ctx)
}

type fakeUserRepo struct {
	byID    map[uint]*models.User
	byEmail map[string]*models.User
}

func newFakeUserRepo() *fakeUserRepo {
	return &fakeUserRepo{byID: make(map[uint]*models.User), byEmail: make(map[string]*models.User)}
}

func (f *fakeUserRepo) add(u *models.User) {
	f.byID[u.ID] = u
	f.byEmail[u.Email] = u
}

func (f *fakeUserRepo) FindByID(ctx context.Context, id uint) (*models.User, error) {
	return f.byID[id], nil
}
func (f *fakeUserRepo) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	return f.byEmail[email], nil
}
func (f *fakeUserRepo) FindByFirebaseUID(ctx context.Context, uid string) (*models.User, error) {
	for _, u := range f.byID {
		if u.FirebaseUID == uid {
			return u, nil
		}
	}
	return nil, nil
}
func (f *fakeUserRepo) Save(ctx context.Context, u *models.User) error {
	f.add(u)
	return nil
}

type fakeShopkeeperEmailRepo struct {
	allowed map[string]bool
}

func (f *fakeShopkeeperEmailRepo) Exists(ctx context.Context, email string) (bool, error) {
	return f.allowed[email], nil
}

type fakeMenuRepo struct{}

func (f *fakeMenuRepo) FindAll(ctx context.Context, onlyAvailable bool) ([]models.MenuItem, error) {
	return nil, nil
}
func (f *fakeMenuRepo) FindByID(ctx context.Context, id uint) (*models.MenuItem, error) {
	return &models.MenuItem{ID: id, Name: "Test Item", Price: 1000, IsAvailable: true, Diet: "veg"}, nil
}
func (f *fakeMenuRepo) FindByIDForUpdate(ctx context.Context, id uint) (*models.MenuItem, error) {
	return f.FindByID(ctx, id)
}
func (f *fakeMenuRepo) FindMapByIDs(ctx context.Context, ids []uint) (map[uint]models.MenuItem, error) {
	return map[uint]models.MenuItem{}, nil
}
func (f *fakeMenuRepo) Save(ctx context.Context, item *models.MenuItem) error    { return nil }
func (f *fakeMenuRepo) Delete(ctx context.Context, id uint) error                { return nil }
func (f *fakeMenuRepo) UpdateStock(ctx context.Context, id uint, oos bool) error { return nil }
func (f *fakeMenuRepo) ResetStock(ctx context.Context) error                     { return nil }

type fakeOrderRepo struct {
	orders map[uint]*models.Order
}

func newFakeOrderRepo() *fakeOrderRepo { return &fakeOrderRepo{orders: make(map[uint]*models.Order)} }

func (f *fakeOrderRepo) Create(ctx context.Context, o *models.Order) error {
	o.ID = uint(len(f.orders) + 1)
	f.orders[o.ID] = o
	return nil
}
func (f *fakeOrderRepo) Save(ctx context.Context, o *models.Order) error {
	f.orders[o.ID] = o
	return nil
}
func (f *fakeOrderRepo) SaveItem(ctx context.Context, i *models.OrderItem) error { return nil }
func (f *fakeOrderRepo) FindByID(ctx context.Context, id uint) (*models.Order, error) {
	return f.orders[id], nil
}
func (f *fakeOrderRepo) FindByIDForUpdate(ctx context.Context, id uint) (*models.Order, error) {
	return f.orders[id], nil
}
func (f *fakeOrderRepo) FindActiveByUserID(ctx context.Context, uid uint) (*models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) FindActiveByUserIDForUpdate(ctx context.Context, uid uint) (*models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) FindHistoryByUserID(ctx context.Context, uid uint) ([]models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) FindIncoming(ctx context.Context) ([]models.Order, error) { return nil, nil }
func (f *fakeOrderRepo) FindIncomingForUpdate(ctx context.Context) ([]models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) FindInProgress(ctx context.Context) ([]models.Order, error) { return nil, nil }
func (f *fakeOrderRepo) FindAwaitingPayment(ctx context.Context) ([]models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) FindTerminalByDate(ctx context.Context, date string) ([]models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) GetMaxOrderNo(ctx context.Context, date string) (int, error) { return 0, nil }
func (f *fakeOrderRepo) FindPreparingOldest(ctx context.Context) ([]models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) FindPreparingOldestForUpdate(ctx context.Context) ([]models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) FindReadyExpired(ctx context.Context) ([]models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) FindReadyExpiredForUpdate(ctx context.Context) ([]models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) FindNonTerminal(ctx context.Context) ([]models.Order, error) { return nil, nil }
func (f *fakeOrderRepo) FindNonTerminalForUpdate(ctx context.Context) ([]models.Order, error) {
	return nil, nil
}
func (f *fakeOrderRepo) HasActiveItemsForMenuItem(ctx context.Context, menuItemID uint) (bool, error) {
	return false, nil
}
func (f *fakeOrderRepo) CountActive(ctx context.Context) (int, error)   { return 0, nil }
func (f *fakeOrderRepo) CountAccepted(ctx context.Context) (int, error) { return 0, nil }
func (f *fakeOrderRepo) SumOrderedQtyByDate(ctx context.Context, date string) (map[uint]int, error) {
	return map[uint]int{}, nil
}

type fakePoolRepo struct{ pool map[uint]int }

func (f *fakePoolRepo) FindAll(ctx context.Context) (map[uint]int, error) { return f.pool, nil }
func (f *fakePoolRepo) Lock(ctx context.Context, id uint) (int, error)    { return f.pool[id], nil }
func (f *fakePoolRepo) Add(ctx context.Context, id uint, qty int) error {
	f.pool[id] += qty
	return nil
}
func (f *fakePoolRepo) Delete(ctx context.Context, id uint) error { delete(f.pool, id); return nil }
func (f *fakePoolRepo) ZeroAll(ctx context.Context) error         { return nil }

type fakeEventRepo struct{}

func (f *fakeEventRepo) Log(ctx context.Context, ev *models.OrderEvent) error { return nil }

type fakeShopStatusRepo struct{ status *models.ShopStatus }

func (f *fakeShopStatusRepo) Get(ctx context.Context) (*models.ShopStatus, error) {
	return f.status, nil
}
func (f *fakeShopStatusRepo) Save(ctx context.Context, s *models.ShopStatus) error {
	f.status = s
	return nil
}

type fakeRatingRepo struct{}

func (f *fakeRatingRepo) SaveAll(ctx context.Context, ratings []models.ItemRating) error { return nil }
func (f *fakeRatingRepo) GetMenuAggregates(ctx context.Context) (map[uint]repository.MenuRatingAggregate, error) {
	return map[uint]repository.MenuRatingAggregate{}, nil
}

type fakePushRepo struct{}

func (f *fakePushRepo) Save(ctx context.Context, sub *models.PushSubscription) error { return nil }
func (f *fakePushRepo) FindByRole(ctx context.Context, role models.Role) ([]models.PushSubscription, error) {
	return nil, nil
}
func (f *fakePushRepo) FindByUserID(ctx context.Context, userID uint) ([]models.PushSubscription, error) {
	return nil, nil
}
func (f *fakePushRepo) DeleteByEndpoint(ctx context.Context, endpoint string) error { return nil }
func (f *fakePushRepo) FindByEndpoint(ctx context.Context, endpoint string) (*models.PushSubscription, error) {
	return nil, nil
}

// ---- test harness -----------------------------------------------------------

const testJWTSecret = "test-jwt-secret-at-least-32-bytes-long!!!"

// harness bundles the fully wired router plus the identities/tokens/ticket
// service a test needs to drive requests against it.
type harness struct {
	router     *gin.Engine
	cfg        *config.Config
	student    models.User
	shopkeeper models.User
	studentTok string
	shopTok    string
	tickets    *services.SSETicketService
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	gin.SetMode(gin.TestMode)

	cfg := &config.Config{
		JWTSecret:          testJWTSecret,
		AllowedEmailDomain: "sst.scaler.com",
		HoldMinutes:        15,
		BusinessTimezone:   "UTC",
		FrontendOrigin:     "http://localhost:5173",
	}

	student := models.User{ID: 1, FirebaseUID: "fb-student", Email: "student@sst.scaler.com", Name: "Stu Dent", Role: models.RoleStudent}
	shopkeeper := models.User{ID: 2, FirebaseUID: "fb-shop", Email: "shop@example.com", Name: "Shop Keeper", Role: models.RoleShopkeeper}

	userRepo := newFakeUserRepo()
	userRepo.add(&student)
	userRepo.add(&shopkeeper)
	emailRepo := &fakeShopkeeperEmailRepo{allowed: map[string]bool{shopkeeper.Email: true}}

	authSvc := services.NewAuthService(userRepo, emailRepo, authn.NewFakeVerifier(), cfg)
	menuSvc := services.NewMenuService(&fakeMenuRepo{}, newFakeOrderRepo(), &fakeRatingRepo{}, &fakePoolRepo{pool: map[uint]int{}}, &fakeUoW{}, realtime.NewHub(), cfg)
	orderRepo := newFakeOrderRepo()
	orderSvc := services.NewOrderService(orderRepo)
	statusSvc := services.NewShopStatusService(&fakeShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}, orderRepo, &fakeUoW{}, realtime.NewHub())
	ratingsSvc := services.NewRatingsService(&fakeRatingRepo{}, orderRepo)
	poolEngine := services.NewPoolEngine(&fakeUoW{}, orderRepo, &fakeMenuRepo{}, &fakePoolRepo{pool: map[uint]int{}}, &fakeEventRepo{}, &fakeShopStatusRepo{status: &models.ShopStatus{ID: 1, State: string(models.ShopOpen)}}, realtime.NewHub(), cfg, &services.FCFSAllocation{})
	pushSvc := services.NewPushService(cfg, &fakePushRepo{})
	ticketSvc := services.NewSSETicketService()
	hub := realtime.NewHub()

	router := routes.Setup(cfg, authSvc, menuSvc, orderSvc, statusSvc, ratingsSvc, poolEngine, pushSvc, ticketSvc, hub)

	studentTok, err := services.GenerateToken(student, cfg.JWTSecret)
	if err != nil {
		t.Fatalf("generate student token: %v", err)
	}
	shopTok, err := services.GenerateToken(shopkeeper, cfg.JWTSecret)
	if err != nil {
		t.Fatalf("generate shopkeeper token: %v", err)
	}

	return &harness{
		router:     router,
		cfg:        cfg,
		student:    student,
		shopkeeper: shopkeeper,
		studentTok: studentTok,
		shopTok:    shopTok,
		tickets:    ticketSvc,
	}
}

// substitutePath fills in Gin path params with a fixed dummy id — auth/role
// gating runs before the handler ever looks at the id, so a dummy is fine
// for every case exercised here.
func substitutePath(path string) string {
	r := strings.NewReplacer(":id", "1", ":itemID", "1", ":menu_item_id", "1")
	return r.Replace(path)
}

// do issues a plain (non-SSE) request against the router with an optional
// bearer token.
func (h *harness) do(method, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

// doSSEExpectReject issues an SSE-style GET with a ticket query param and
// expects the request to be rejected by middleware (401/403) before it ever
// reaches the long-lived stream handler — so, unlike doSSEExpectAccept
// below, this is a plain synchronous call.
func (h *harness) doSSEExpectReject(path, ticket string) *httptest.ResponseRecorder {
	url := path
	if ticket != "" {
		url += "?ticket=" + ticket
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

// syncFlushRecorder wraps httptest.ResponseRecorder and signals, via a
// channel close rather than a polled field, the moment the handler under
// test calls Flush() for the first time. Polling the embedded recorder's
// Flushed/Code fields directly from a second goroutine (as an earlier
// version of this helper did) is a data race — those fields are written by
// the handler goroutine with no synchronization a plain busy-loop read can
// see safely under -race. A channel close is a proper happens-before edge:
// once the receive on flushedCh returns, every write the handler goroutine
// made before calling Flush() (including c.Status's write to Code) is
// guaranteed visible.
type syncFlushRecorder struct {
	*httptest.ResponseRecorder
	once      sync.Once
	flushedCh chan struct{}
}

func newSyncFlushRecorder() *syncFlushRecorder {
	return &syncFlushRecorder{ResponseRecorder: httptest.NewRecorder(), flushedCh: make(chan struct{})}
}

func (r *syncFlushRecorder) Flush() {
	r.ResponseRecorder.Flush()
	r.once.Do(func() { close(r.flushedCh) })
}

// doSSEExpectAccept issues an SSE GET whose ticket is expected to pass both
// RequireSSEAuth and the role gate, meaning the handler reaches streamSSE
// and blocks on its request context forever (see controllers/orders.go).
// It runs the request in a goroutine, waits for the handler to flush the
// response headers (proof it got past every gate), then cancels the
// request's context to unblock the handler and let it return, and finally
// returns the recorded status code. Times out the test if the handler never
// flushes at all (a real regression, not just a lingering goroutine).
func (h *harness) doSSEExpectAccept(t *testing.T, path, ticket string) int {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, path+"?ticket="+ticket, nil).WithContext(ctx)
	rec := newSyncFlushRecorder()

	done := make(chan struct{})
	go func() {
		defer close(done)
		h.router.ServeHTTP(rec, req)
	}()

	select {
	case <-rec.flushedCh:
	case <-time.After(2 * time.Second):
		cancel()
		<-done
		t.Fatalf("SSE handler for %s never flushed a response within the deadline", path)
	}
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("SSE handler for %s did not return after context cancellation", path)
	}
	return rec.Code
}

// ---- route classification --------------------------------------------------

type category int

const (
	catPublic category = iota // reachable with no token at all
	catAny                    // any authenticated role (student or shopkeeper)
	catStudent
	catShopkeeper
)

type routeSpec struct {
	category category
	sse      bool // authenticates via SSE ticket, not a Bearer JWT
}

// expectedRoutes is the hand-audited source of truth for what routes.go's
// grouping *should* produce, keyed by (method, path) exactly as Gin's
// router.Routes() reports them (including the ":param" placeholders). The
// test below iterates the engine's *actual* registered routes and looks
// each one up here — any route Setup registers that isn't a key fails the
// test outright, so a newly added, unclassified route cannot silently pass.
var expectedRoutes = map[string]routeSpec{
	"GET /api/health":                                  {category: catPublic},
	"GET /api/menu":                                    {category: catPublic},
	"GET /api/shop-status":                             {category: catPublic},
	"GET /api/auth/config":                             {category: catPublic},
	"POST /api/auth/firebase":                          {category: catPublic},
	"GET /api/auth/me":                                 {category: catAny},
	"POST /api/auth/sse-ticket":                        {category: catAny},
	"GET /api/push/vapid-public-key":                   {category: catPublic},
	"POST /api/push/subscribe":                         {category: catAny},
	"POST /api/orders":                                 {category: catStudent},
	"GET /api/orders/active":                           {category: catStudent},
	"GET /api/orders":                                  {category: catStudent},
	"POST /api/orders/:id/cancel":                      {category: catStudent},
	"POST /api/orders/:id/ratings":                     {category: catStudent},
	"GET /api/stream":                                  {category: catStudent, sse: true},
	"GET /api/shop/menu":                               {category: catShopkeeper},
	"POST /api/shop/menu":                              {category: catShopkeeper},
	"PUT /api/shop/menu/:id":                           {category: catShopkeeper},
	"DELETE /api/shop/menu/:id":                        {category: catShopkeeper},
	"POST /api/shop/menu/:id/stock":                    {category: catShopkeeper},
	"POST /api/shop/menu/photo-signature":              {category: catShopkeeper},
	"GET /api/shop/orders":                             {category: catShopkeeper},
	"GET /api/shop/history":                            {category: catShopkeeper},
	"POST /api/shop/orders/:id/accept":                 {category: catShopkeeper},
	"POST /api/shop/orders/:id/reject":                 {category: catShopkeeper},
	"GET /api/shop/prep":                               {category: catShopkeeper},
	"POST /api/shop/prep/:menu_item_id/done":           {category: catShopkeeper},
	"POST /api/shop/orders/:id/items/:itemID/handover": {category: catShopkeeper},
	"DELETE /api/shop/orders/:id/items/:itemID":        {category: catShopkeeper},
	"POST /api/shop/orders/:id/paid":                   {category: catShopkeeper},
	"POST /api/shop/status":                            {category: catShopkeeper},
	"GET /api/shop/stream":                             {category: catShopkeeper, sse: true},
}

func isAuthFailure(code int) bool {
	return code == http.StatusUnauthorized || code == http.StatusForbidden
}

// TestRouteAuthMatrix drives the auth/role gate for every route
// routes.Setup actually registers, enumerated via router.Routes() rather
// than a hand-typed path list — see the package doc comment for why that
// matters.
func TestRouteAuthMatrix(t *testing.T) {
	h := newHarness(t)

	registered := h.router.Routes()
	if len(registered) == 0 {
		t.Fatal("router.Routes() returned no routes — Setup did not register anything")
	}

	seen := make(map[string]bool)
	publicRoutes := make(map[string]bool)

	for _, ri := range registered {
		key := ri.Method + " " + ri.Path
		spec, ok := expectedRoutes[key]
		if !ok {
			t.Errorf("route %s is registered but not classified in expectedRoutes — "+
				"a new route was added without updating this test's auth matrix", key)
			continue
		}
		seen[key] = true

		t.Run(key, func(t *testing.T) {
			path := substitutePath(ri.Path)

			if spec.sse {
				testSSERoute(t, h, spec, ri.Method, path)
				if spec.category == catPublic {
					publicRoutes[key] = true
				}
				return
			}

			// 1. No token at all.
			rec := h.do(ri.Method, path, "")
			switch spec.category {
			case catPublic:
				if isAuthFailure(rec.Code) {
					t.Errorf("no token: expected a non-401/403 status (public route), got %d", rec.Code)
				}
				publicRoutes[key] = true
			default:
				if rec.Code != http.StatusUnauthorized {
					t.Errorf("no token: expected 401, got %d", rec.Code)
				}
			}

			// 2. Valid student token.
			studentRec := h.do(ri.Method, path, h.studentTok)
			switch spec.category {
			case catShopkeeper:
				if studentRec.Code != http.StatusForbidden {
					t.Errorf("student token on shopkeeper-only route: expected 403, got %d", studentRec.Code)
				}
			case catStudent, catAny, catPublic:
				if isAuthFailure(studentRec.Code) {
					t.Errorf("student token: expected a non-401/403 status, got %d", studentRec.Code)
				}
			}

			// 3. Valid shopkeeper token.
			shopRec := h.do(ri.Method, path, h.shopTok)
			switch spec.category {
			case catStudent:
				if shopRec.Code != http.StatusForbidden {
					t.Errorf("shopkeeper token on student-only route: expected 403, got %d", shopRec.Code)
				}
			case catShopkeeper, catAny, catPublic:
				if isAuthFailure(shopRec.Code) {
					t.Errorf("shopkeeper token: expected a non-401/403 status, got %d", shopRec.Code)
				}
			}
		})
	}

	for key := range expectedRoutes {
		if !seen[key] {
			t.Errorf("expectedRoutes has an entry for %s but routes.Setup never registered it — "+
				"the route table shrank or this test's matrix is stale", key)
		}
	}

	// The public-route allowlist the task asked to pin down explicitly.
	wantPublic := map[string]bool{
		"GET /api/health":                true,
		"GET /api/menu":                  true,
		"GET /api/shop-status":           true,
		"GET /api/push/vapid-public-key": true,
		"POST /api/auth/firebase":        true,
		// GET /api/auth/config is ALSO reachable with no token in the real
		// route table (routes.go never puts requireAuth in front of it) —
		// see the discrepancy noted in TestPublicRouteSetIsExact.
		"GET /api/auth/config": true,
	}
	if len(publicRoutes) != len(wantPublic) {
		t.Errorf("public route set = %v, want %v", publicRoutes, wantPublic)
	}
	for k := range wantPublic {
		if !publicRoutes[k] {
			t.Errorf("expected %s to be publicly reachable, it wasn't", k)
		}
	}
	for k := range publicRoutes {
		if !wantPublic[k] {
			t.Errorf("%s is publicly reachable but is not in the expected public set", k)
		}
	}
}

func testSSERoute(t *testing.T, h *harness, spec routeSpec, method, path string) {
	t.Helper()

	// No ticket at all -> 401.
	rec := h.doSSEExpectReject(path, "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("no ticket: expected 401, got %d", rec.Code)
	}

	// Bogus ticket -> 401.
	rec = h.doSSEExpectReject(path, "not-a-real-ticket")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("bogus ticket: expected 401, got %d", rec.Code)
	}

	wrongUserID := h.shopkeeper.ID
	if spec.category == catShopkeeper {
		wrongUserID = h.student.ID
	}
	wrongTicket, err := h.tickets.Mint(wrongUserID)
	if err != nil {
		t.Fatalf("mint wrong-role ticket: %v", err)
	}
	rec = h.doSSEExpectReject(path, wrongTicket)
	if rec.Code != http.StatusForbidden {
		t.Errorf("wrong-role ticket: expected 403, got %d", rec.Code)
	}

	rightUserID := h.student.ID
	if spec.category == catShopkeeper {
		rightUserID = h.shopkeeper.ID
	}
	rightTicket, err := h.tickets.Mint(rightUserID)
	if err != nil {
		t.Fatalf("mint right-role ticket: %v", err)
	}
	code := h.doSSEExpectAccept(t, path, rightTicket)
	if isAuthFailure(code) {
		t.Errorf("right-role ticket: expected a non-401/403 status, got %d", code)
	}

	// Single-use: the same ticket used again must now be rejected.
	rec = h.doSSEExpectReject(path, rightTicket)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("re-using a consumed ticket: expected 401, got %d", rec.Code)
	}
}

// TestSSETicketSingleUseAcrossStreams is a focused, narrative version of the
// single-use property TestRouteAuthMatrix already checks per-route: mint one
// ticket for the student stream, consume it via a successful connect, then
// prove a second connect attempt with that same ticket is rejected.
func TestSSETicketSingleUseAcrossStreams(t *testing.T) {
	h := newHarness(t)
	ticket, err := h.tickets.Mint(h.student.ID)
	if err != nil {
		t.Fatalf("mint ticket: %v", err)
	}

	code := h.doSSEExpectAccept(t, "/api/stream", ticket)
	if isAuthFailure(code) {
		t.Fatalf("first connect with a fresh ticket should succeed, got %d", code)
	}

	rec := h.doSSEExpectReject("/api/stream", ticket)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("second connect with the same (now-consumed) ticket: expected 401, got %d", rec.Code)
	}
}

// TestStudentCannotOpenShopStream is a focused version of the role-mismatch
// case TestRouteAuthMatrix already exercises for every SSE route: a
// student's own (validly authenticated, validly ticketed) attempt to open
// the shopkeeper stream must be 403, not 401 — the ticket itself is good,
// only the role is wrong.
func TestStudentCannotOpenShopStream(t *testing.T) {
	h := newHarness(t)
	ticket, err := h.tickets.Mint(h.student.ID)
	if err != nil {
		t.Fatalf("mint ticket: %v", err)
	}
	rec := h.doSSEExpectReject("/api/shop/stream", ticket)
	if rec.Code != http.StatusForbidden {
		t.Errorf("student opening /api/shop/stream: expected 403, got %d", rec.Code)
	}
}

// TestExpectedRoutesCoversLiveRouteTable is a cheap, fast sanity check
// (no HTTP calls) that fails fast with a precise diff if the app's route
// table and this test's classification map ever drift apart, independent of
// the full (slower) auth-matrix run above.
func TestExpectedRoutesCoversLiveRouteTable(t *testing.T) {
	h := newHarness(t)
	live := make(map[string]bool)
	for _, ri := range h.router.Routes() {
		live[fmt.Sprintf("%s %s", ri.Method, ri.Path)] = true
	}
	for k := range live {
		if _, ok := expectedRoutes[k]; !ok {
			t.Errorf("live route %s has no entry in expectedRoutes", k)
		}
	}
	for k := range expectedRoutes {
		if !live[k] {
			t.Errorf("expectedRoutes has stale entry %s not present in the live route table", k)
		}
	}
}
