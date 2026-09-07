import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opens a route to unauthenticated callers.
 *
 * The JWT guard is registered globally, so every route is protected
 * unless it carries this decorator. Forgetting it leaves a route
 * closed, which is the failure direction we want.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
