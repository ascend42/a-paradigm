# Error Patterns

> Standard error handling across the project (Language-Agnostic)

## Error Response Format

All APIs/services return errors in this format:

```
// Error response
{
  error: string       // Human-readable message
  code?: string       // Machine-readable code (optional)
}

// Success response  
{
  success?: true      // Optional confirmation
  data?: any          // Response payload
}
```

## Standard Error Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| `INVALID_REQUEST` | Malformed input | Missing fields, wrong types |
| `INVALID_CREDENTIALS` | Auth validation failed | Wrong password, expired token |
| `UNAUTHORIZED` | Not authenticated | Missing/expired session |
| `FORBIDDEN` | Authenticated but denied | Insufficient permissions |
| `NOT_FOUND` | Resource doesn't exist | Unknown ID, deleted item |
| `CONFLICT` | State conflict | Duplicate entry, version mismatch |
| `RATE_LIMITED` | Too many requests | Brute force protection |
| `SERVER_ERROR` | Internal error | Database down, unexpected crash |
| `UNAVAILABLE` | Service unavailable | Maintenance, overloaded |

## Patterns (Pseudocode)

### Basic Error Return

```
// Simple error
return error_response("Invalid request", status=400)

// With code
return error_response("Too many attempts", code="RATE_LIMITED", status=429)
```

### Input Validation

```
function handle_request(request):
    data = parse_json(request.body)
    
    if data is null:
        return error_response("Invalid request body", status=400)
    
    if not valid_email(data.email):
        return error_response("Valid email required", status=400)
    
    // Continue processing...
```

### Auth Check

```
function require_auth(request):
    user = get_user_from_session(request)
    
    if user is null:
        return error_response("Unauthorized", status=401)
    
    return user
```

### Resource Access

```
function get_resource(id):
    resource = database.find(id)
    
    if resource is null:
        return error_response("Not found", status=404)
    
    if not user_can_access(resource):
        return error_response("Forbidden", status=403)
    
    return success_response(resource)
```

### Database Operations

```
function query_database(query, params):
    try:
        result = db.execute(query, params)
        return result
    catch DatabaseError as error:
        log.component('#database').error('Query failed', { error })
        return error_response("Database error", status=500)
```

## Error Handling Flow

```
┌─────────────────┐
│  Receive Input  │
└────────┬────────┘
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Validate Input  │────▶│ 400 Bad Request │
└────────┬────────┘ no  └─────────────────┘
         │ yes
         ▼
┌─────────────────┐     ┌─────────────────┐
│   Check Auth    │────▶│ 401 Unauthorized│
└────────┬────────┘ no  └─────────────────┘
         │ yes
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Check Permission│────▶│  403 Forbidden  │
└────────┬────────┘ no  └─────────────────┘
         │ yes
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Find Resource  │────▶│  404 Not Found  │
└────────┬────────┘ no  └─────────────────┘
         │ yes
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Execute Action  │────▶│ 500 Server Error│
└────────┬────────┘ fail└─────────────────┘
         │ ok
         ▼
┌─────────────────┐
│  200 Success    │
└─────────────────┘
```

## Logging Errors

Always use the Paradigm logger (v2):

```
// Component context (features, services, integrations)
log.component('#checkout-handler').error('Payment failed', { reason, order_id })
log.component('#database').error('Connection lost', { host })
log.component('#stripe-service').error('API error', { status, message })

// Gate context
log.gate('^authenticated').warn('Access denied', { user_id, resource })

// Signal context
log.signal('!payment-failed').error('Payment declined', { order_id, reason })
```

## Graceful Degradation

When non-critical features fail, don't block the user:

```
// Bad: crashes if optional feature fails
data = fetch_optional_feature()  // throws on error

// Good: graceful fallback
data = null
try:
    data = fetch_optional_feature()
catch:
    log.component('#optional').debug('Feature unavailable, using fallback')

// Continue with or without optional data
```

## Client-Side Handling

```
function api_call(endpoint, options):
    try:
        response = http.request(endpoint, options)
        
        if not response.ok:
            return { error: response.data.error or "Request failed" }
        
        return { data: response.data }
    catch NetworkError:
        return { error: "Connection error" }
```

## Error State in UI

```
// State
error = null

function submit():
    error = null  // Clear previous error
    
    result = api_call('/endpoint', data)
    
    if result.error:
        error = result.error
        return
    
    // Success handling...

// Display
if error:
    show_error_message(error)
```

---

## CLI Error Patterns

Paradigm CLI commands produce actionable error messages that include:
1. **What went wrong** — clear description of the error
2. **Why** — context about the cause
3. **What to do** — concrete next steps

### Sentinel Startup Errors

| Error | Message | Recovery |
|-------|---------|----------|
| Module not found | `@a-company/sentinel is not installed` | `npm install @a-company/sentinel` |
| Port in use | `Port 3838 is already in use` | `paradigm sentinel --port 3839` |
| Permission denied | `Permission denied on port N` | Use a port above 1024 |
| Dir not found | `Project directory not found: /path` | Verify the path exists |
| Network error | `Network connection failed` | Check network configuration |
| Unknown error | Shows error message + code + 3 recovery steps | Follow recovery steps or run `paradigm doctor` |

### Flow Validation Errors

| Error | Message | Recovery |
|-------|---------|----------|
| Legacy v1 symbol | `"@feature" uses deprecated v1 prefix "@". Use #component with tags: [feature]` | Migrate to v2 symbol |
| Invalid symbol | `Invalid symbol format "foo" — must start with a v2 prefix (#, $, ^, !, ~)` | Add correct prefix |
| Missing gate | `Gate ^name not declared in portal.yaml` | Add gate to portal.yaml |
| Type mismatch | `Symbol ^gate should have type 'gate', got 'action'` | Fix the step type |

### General Error Message Guidelines

When adding new CLI error messages, follow this pattern:

```typescript
// BAD - generic, unhelpful
console.error('Error:', error);

// GOOD - actionable with recovery steps
console.error(chalk.red('\nError: Port 3838 is already in use.'));
console.log(chalk.gray('Try a different port with: paradigm sentinel --port 3839\n'));

// GOOD - categorized with multiple recovery options
console.error(chalk.red('\nFailed to start Sentinel.'));
console.error(chalk.gray(`  Error: ${errMsg}`));
console.log(chalk.gray('\nIf this persists, try:'));
console.log(chalk.gray('  1. Ensure @a-company/sentinel is up to date'));
console.log(chalk.gray('  2. Run `paradigm doctor` to check your setup'));
```

---

*Part of Paradigm v2.0 - Language Agnostic*
