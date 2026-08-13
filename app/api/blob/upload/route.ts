import { NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Issues short-lived client tokens so the browser can upload large files
// DIRECTLY to Vercel Blob (bypassing the serverless request-size limit).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        if (!getSession()) throw new Error("Unauthorized");
        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
            "video/mp4",
            "video/quicktime",
          ],
          addRandomSuffix: true,
          maximumSizeInBytes: 500 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {
        // The client registers the media record via /api/media/register.
      },
    });
    return Response.json(jsonResponse);
  } catch (e: any) {
    return Response.json({ error: e?.message || "Upload token error" }, { status: 400 });
  }
}
