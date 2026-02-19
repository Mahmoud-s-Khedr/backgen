import type { ParsedSchema, GeneratedFile } from '../../parser/types.js';
import { renderTemplate } from '../template-engine.js';

/**
 * Generate module files for each model: controller, service, routes, dto, test.
 */
export function generateModuleFiles(schema: ParsedSchema): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    for (const model of schema.models) {
        const modelLower = model.name.charAt(0).toLowerCase() + model.name.slice(1);
        const modulePath = `src/modules/${modelLower}`;

        // Separate field categories for template use
        const scalarFields = model.fields.filter((f) => !f.isRelation);
        const relationFields = model.fields.filter((f) => f.isRelation);
        const createFields = scalarFields.filter(
            (f) => !f.isId && !f.directives.includes('hidden') && !f.directives.includes('readonly') && (!f.hasDefault || f.directives.includes('writeOnly'))
        );
        const responseFields = scalarFields.filter(
            (f) => !f.directives.includes('hidden') && !f.directives.includes('writeOnly')
        );
        const fkFields = model.fields
            .map((f) => f.relationField)
            .filter((f): f is string => f !== undefined);

        const isProtected = model.directives.includes('protected');

        const templateData = {
            model,
            modelLower,
            scalarFields,
            relationFields,
            createFields,
            responseFields,
            fkFields,
            allModels: schema.models,
            enums: schema.enums,
            isProtected,
        };

        files.push({
            path: `${modulePath}/${modelLower}.controller.ts`,
            content: renderTemplate('module/controller.ts.ejs', templateData),
        });

        files.push({
            path: `${modulePath}/${modelLower}.service.ts`,
            content: renderTemplate('module/service.ts.ejs', templateData),
        });

        files.push({
            path: `${modulePath}/${modelLower}.routes.ts`,
            content: renderTemplate('module/routes.ts.ejs', templateData),
        });

        files.push({
            path: `${modulePath}/${modelLower}.dto.ts`,
            content: renderTemplate('module/dto.ts.ejs', templateData),
        });

        files.push({
            path: `${modulePath}/${modelLower}.test.ts`,
            content: renderTemplate('module/test.ts.ejs', templateData),
        });
    }

    return files;
}
