import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate app.ts, server.ts, and optionally auth routes.
 */
export function generateAppFiles(schema: ParsedSchema, framework: 'express' | 'fastify' = 'express', jobsProvider?: 'bullmq' | 'pg-boss', wsEnabled?: boolean): GeneratedFile[] {
    const authModel = schema.models.find(m => m.isAuthModel);
    const hasAuthRoutes = !!authModel && !!authModel.identifierField && !!authModel.passwordField;
    const isFastify = framework === 'fastify';
    const authModelLower = authModel
        ? authModel.name.charAt(0).toLowerCase() + authModel.name.slice(1)
        : undefined;
    const multitenancyClaimFields = authModel
        ? [...new Set(
            schema.models
                .map((model) => model.multitenancyConfig?.field)
                .filter((field): field is string => Boolean(field))
        )].filter((fieldName) => (
            fieldName !== authModel.identifierField
            && fieldName !== authModel.roleField
            && fieldName !== 'id'
            && authModel.fields.some((field) => (
                field.name === fieldName
                && !field.isRelation
                && !field.isList
            ))
        ))
        : [];

    const data = {
        models: schema.models,
        schema,
        hasAuthRoutes,
        authModel,
        authModelLower,
        identifierField: authModel?.identifierField,
        passwordField: authModel?.passwordField,
        roleField: authModel?.roleField,
        framework,
        jobsProvider: jobsProvider ?? null,
        wsEnabled: wsEnabled ?? false,
    };

    const files: GeneratedFile[] = [
        {
            path: 'src/app.ts',
            content: renderTemplate(isFastify ? 'app-fastify.ts.ejs' : 'app.ts.ejs', data),
        },
        {
            path: 'src/server.ts',
            content: renderTemplate(isFastify ? 'server-fastify.ts.ejs' : 'server.ts.ejs', data),
        },
    ];

    if (hasAuthRoutes && authModel) {
        const authData = {
            authModel,
            authModelLower,
            identifierField: authModel.identifierField,
            passwordField: authModel.passwordField,
            roleField: authModel.roleField,
            multitenancyClaimFields,
            framework,
        };
        files.push({
            path: 'src/modules/auth/auth.routes.ts',
            content: renderTemplate(
                isFastify ? 'auth/auth.routes-fastify.ts.ejs' : 'auth/auth.routes.ts.ejs',
                authData
            ),
        });
    }

    return files;
}
