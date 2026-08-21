/**
 * Regression checklist from Admin V2 spec §57.
 * Run manually against staging after deploy; keep this file as the source of truth.
 *
 * Users
 * - [ ] Suspend works
 * - [ ] Activate works
 * - [ ] User can log in after activation
 * - [ ] Suspended user is blocked
 *
 * Wallet
 * - [ ] Credit updates balance
 * - [ ] Debit updates balance
 * - [ ] Refund works
 * - [ ] Transaction appears correctly
 *
 * Agents
 * - [ ] Admin edits agent
 * - [ ] User sees updated agent
 * - [ ] Agent remains callable
 *
 * Pricing
 * - [ ] New customer price applies only after effective date
 * - [ ] Historical pricing remains unchanged
 * - [ ] /billing/rates reflects active customer_pricing_rates
 *
 * Cost
 * - [ ] New provider cost applies only after effective date
 * - [ ] Historical cost remains unchanged
 * - [ ] New usage events pick up effective-dated provider_cost_rates
 *
 * Managed Keys
 * - [ ] Key can be added
 * - [ ] Key is validated before activation
 * - [ ] Key is masked
 * - [ ] Health check works
 * - [ ] Rotation works
 * - [ ] Previous key is retired correctly
 * - [ ] Revocation works
 * - [ ] Audit record is created
 * - [ ] User-side service continues after successful rotation
 *
 * Numbers / Voices / Prompts / Impersonation
 * - [ ] Number management remains synchronized
 * - [ ] Admin voice list reaches user builder
 * - [ ] Active prompt template reaches generation flow
 * - [ ] Impersonation opens exact user dashboard with scoped permissions
 */
export const ADMIN_V2_REGRESSION_CHECKLIST = true;
