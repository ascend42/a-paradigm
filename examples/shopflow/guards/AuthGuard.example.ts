/**
 * AuthGuard Example
 *
 * Demonstrates how to use Portal Validator in a route guard.
 * This is a reference implementation showing the pattern - adapt for your framework.
 *
 * The key insight: Portal Validator emits structured console output that
 * AI agents can read to validate authorization flows.
 */

import { portal } from '@a-company/portal-sdk';

// Example user type
interface User {
  id: string;
  email: string;
  role: 'user' | 'admin' | 'super_admin';
}

// Example subscription type
interface Subscription {
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'trialing' | 'canceled' | 'expired';
  trialConversionsUsed?: number;
}

// Example auth context
interface AuthContext {
  user: User | null;
  subscription: Subscription | null;
  loading: boolean;
}

/**
 * Example: Authentication Guard
 *
 * When this runs, the console will show:
 *
 * ┌─────────────────────────────────────────────────────────
 * │ 🚪 PORTAL CHECK: ^authenticated
 * │ ├─ Requires: valid user session
 * │ ├─ Context: { path: "/checkout", hasUser: false }
 * │ ├─ Decision: ❌ DENY
 * │ └─ Reason: No active session - redirecting to login
 * └─────────────────────────────────────────────────────────
 */
export function checkAuthenticated(
  auth: AuthContext,
  path: string
): { allowed: boolean; redirect?: string } {
  const gate = portal
    .check('^authenticated')
    .requires('valid user session')
    .context({ path, hasUser: !!auth.user });

  if (auth.loading) {
    gate.pending('Checking authentication status...');
    return { allowed: false }; // Show loading state
  }

  if (!auth.user) {
    gate.deny('No active session - redirecting to login');
    return { allowed: false, redirect: '/login' };
  }

  gate.allow('User authenticated');
  return { allowed: true };
}

/**
 * Example: Subscription Guard
 *
 * When this runs with a user on free plan:
 *
 * ┌─────────────────────────────────────────────────────────
 * │ 🚪 PORTAL CHECK: ^premium-checkout
 * │ ├─ Requires: active subscription, plan is pro or enterprise
 * │ ├─ Context: { userId: "123", plan: "free", status: "active" }
 * │ ├─ Decision: ❌ DENY
 * │ └─ Reason: Free plan does not include premium checkout - upgrade required
 * └─────────────────────────────────────────────────────────
 */
export function checkPremiumFeature(
  auth: AuthContext,
  featureName: string
): { allowed: boolean; redirect?: string } {
  const gate = portal
    .check('^premium-checkout')
    .requires('active subscription', 'plan is pro or enterprise')
    .context({
      userId: auth.user?.id,
      plan: auth.subscription?.plan,
      status: auth.subscription?.status,
    });

  // Check if user has subscription
  if (!auth.subscription) {
    gate.deny(`No subscription - ${featureName} requires a paid plan`);
    return { allowed: false, redirect: '/pricing' };
  }

  // Check subscription status
  if (auth.subscription.status !== 'active' && auth.subscription.status !== 'trialing') {
    gate.deny(`Subscription ${auth.subscription.status} - please renew to access ${featureName}`);
    return { allowed: false, redirect: '/billing' };
  }

  // Check plan level
  if (auth.subscription.plan === 'free') {
    gate.deny(`Free plan does not include ${featureName} - upgrade required`);
    return { allowed: false, redirect: '/pricing' };
  }

  gate.allow(`${auth.subscription.plan} plan includes ${featureName}`);
  return { allowed: true };
}

/**
 * Example: Admin Guard
 *
 * When a non-admin tries to access admin panel:
 *
 * ┌─────────────────────────────────────────────────────────
 * │ 🚪 PORTAL CHECK: ^admin-panel
 * │ ├─ Requires: admin or super_admin role
 * │ ├─ Context: { userId: "123", role: "user", path: "/admin" }
 * │ ├─ Decision: ❌ DENY
 * │ └─ Reason: Admin access required - current role: user
 * └─────────────────────────────────────────────────────────
 */
export function checkAdminAccess(
  auth: AuthContext,
  path: string
): { allowed: boolean; redirect?: string } {
  const gate = portal
    .check('^admin-panel')
    .requires('admin or super_admin role')
    .context({
      userId: auth.user?.id,
      role: auth.user?.role,
      path,
    });

  if (!auth.user) {
    gate.deny('Not authenticated - redirecting to login');
    return { allowed: false, redirect: '/login' };
  }

  if (auth.user.role !== 'admin' && auth.user.role !== 'super_admin') {
    gate.deny(`Admin access required - current role: ${auth.user.role}`);
    return { allowed: false, redirect: '/dashboard' };
  }

  gate.allow(`Admin access granted - role: ${auth.user.role}`);
  return { allowed: true };
}

/**
 * Example: Multi-Gate Flow
 *
 * Some routes require multiple gates to pass.
 * Each gate emits its own validation block.
 */
export function checkAdminBilling(auth: AuthContext): {
  allowed: boolean;
  redirect?: string;
  failedGate?: string;
} {
  // Gate 1: Must be authenticated
  const authResult = checkAuthenticated(auth, '/admin/billing');
  if (!authResult.allowed) {
    return { ...authResult, failedGate: '^authenticated' };
  }

  // Gate 2: Must be admin
  const adminResult = checkAdminAccess(auth, '/admin/billing');
  if (!adminResult.allowed) {
    return { ...adminResult, failedGate: '^admin-panel' };
  }

  // Gate 3: Additional billing permission check
  const billingGate = portal
    .check('^billing-access')
    .requires('admin with billing permissions')
    .context({
      userId: auth.user?.id,
      role: auth.user?.role,
    });

  // Super admins always have billing access
  if (auth.user?.role === 'super_admin') {
    billingGate.allow('Super admin - full billing access');
    return { allowed: true };
  }

  // Regular admins need explicit permission (example check)
  const hasBillingPermission = true; // In real app, check permissions
  if (!hasBillingPermission) {
    billingGate.deny('Admin does not have billing permissions');
    return { allowed: false, redirect: '/admin', failedGate: '^billing-access' };
  }

  billingGate.allow('Admin with billing permissions');
  return { allowed: true };
}

/**
 * Example: Quick validation for public routes
 *
 * For routes that don't require authentication, still log the gate check
 * to maintain a complete audit trail.
 */
export function checkPublicAccess(path: string): { allowed: boolean } {
  portal.allow('^public-access', 'Route is public - no authentication required', { path });
  return { allowed: true };
}

// =============================================================================
// React Hook Example (for reference)
// =============================================================================

/**
 * Example React hook pattern (pseudo-code)
 *
 * ```tsx
 * function useAuthGuard(requiredRole?: 'admin' | 'super_admin') {
 *   const { user, subscription, loading } = useAuth();
 *   const location = useLocation();
 *   const navigate = useNavigate();
 *
 *   useEffect(() => {
 *     if (loading) return;
 *
 *     const gate = portal.check('^authenticated')
 *       .requires('valid user session')
 *       .context({ path: location.pathname, hasUser: !!user });
 *
 *     if (!user) {
 *       gate.deny('No active session');
 *       navigate('/login', { state: { from: location } });
 *       return;
 *     }
 *
 *     if (requiredRole) {
 *       const roleGate = portal.check('^role-required')
 *         .requires(`role: ${requiredRole}`)
 *         .context({ userRole: user.role, requiredRole });
 *
 *       if (user.role !== requiredRole && user.role !== 'super_admin') {
 *         roleGate.deny(`Required role: ${requiredRole}, current: ${user.role}`);
 *         navigate('/unauthorized');
 *         return;
 *       }
 *       roleGate.allow(`Role requirement met`);
 *     }
 *
 *     gate.allow('User authenticated');
 *   }, [user, loading, location, navigate, requiredRole]);
 *
 *   return { loading, user, subscription };
 * }
 * ```
 */
