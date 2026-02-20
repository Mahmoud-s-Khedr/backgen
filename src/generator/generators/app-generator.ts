import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate app.ts, server.ts, and optionally auth routes.
 */
export function generateAppFiles(schema: ParsedSchema): GeneratedFile[] {
    const authModel = schema.models.find(m => m.isAuthModel);
    const hasAuthRoutes = !!authModel && !!authModel.identifierField && !!authModel.passwordField;
    const authModelLower = authModel
        ? authModel.name.charAt(0).toLowerCase() + authModel.name.slice(1)
        : undefined;

    const data = {
        models: schema.models,
        schema,
        hasAuthRoutes,
        authModel,
        authModelLower,
        identifierField: authModel?.identifierField,
        passwordField: authModel?.passwordField,
    };

    const files: GeneratedFile[] = [
        {
            path: 'src/app.ts',
            content: renderTemplate('app.ts.ejs', data),
        },
        {
            path: 'src/server.ts',
            content: renderTemplate('server.ts.ejs', data),
        },
    ];

    if (hasAuthRoutes && authModel) {
        files.push({
            path: 'src/modules/auth/auth.routes.ts',
            content: renderTemplate('auth/auth.routes.ts.ejs', {
                authModel,
                authModelLower,
                identifierField: authModel.identifierField,
                passwordField: authModel.passwordField,
            }),
        });
    }

    return files;
}
