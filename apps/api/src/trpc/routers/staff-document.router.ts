import { staffDocumentListQuerySchema } from '../../staff-document/staff-document.schemas';
import { StaffDocumentService } from '../../staff-document/staff-document.service';
import { protectedProcedure, router } from '../trpc';

// #1049 — Döküman listesi. Upload/serve/delete REST'te (multipart + stream);
// tRPC yalnız metadata listesi. Yetki service katmanında: view:staffDocument
// yoksa kullanıcı kendi dökümanlarına daraltılır (#1051 self-service temeli).
export const staffDocumentRouterFactory = (documents: StaffDocumentService) =>
  router({
    list: protectedProcedure.input(staffDocumentListQuerySchema).query(({ input, ctx }) =>
      documents.list(input, {
        id: ctx.user!.sub,
        roles: ctx.user!.roles,
        effectivePerms: ctx.user!.effectivePerms,
      }),
    ),
  });
