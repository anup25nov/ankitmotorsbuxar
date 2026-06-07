import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2, Image as ImageIcon, Video } from "lucide-react";
import {
  deleteMedia,
  fetchBikeMedia,
  signedUrl,
  uploadMedia,
  type BikeMedia,
} from "@/lib/bikes";

interface Props {
  bikeId: string;
}

export function MediaManager({ bikeId }: Props) {
  const [items, setItems] = useState<(BikeMedia & { url?: string | null })[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const media = await fetchBikeMedia(bikeId);
    const withUrls = await Promise.all(
      media.map(async (m) => ({ ...m, url: await signedUrl(m.file_url) })),
    );
    setItems(withUrls);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bikeId]);

  const handleUpload = async (files: FileList | null, type: "photo" | "video") => {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadMedia(bikeId, file, type);
      }
      toast.success(`${type === "photo" ? "Photos" : "Video"} uploaded`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (m: BikeMedia) => {
    if (!confirm("Delete this file?")) return;
    try {
      await deleteMedia(m);
      toast.success("Deleted");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label className="text-sm flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Add Photos
          </Label>
          <Input
            type="file"
            accept="image/*"
            multiple
            disabled={loading}
            onChange={(e) => {
              handleUpload(e.target.files, "photo");
              e.target.value = "";
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-sm flex items-center gap-2">
            <Video className="h-4 w-4" /> Add Video
          </Label>
          <Input
            type="file"
            accept="video/*"
            disabled={loading}
            onChange={(e) => {
              handleUpload(e.target.files, "video");
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No media yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((m) => (
            <div
              key={m.id}
              className="group relative overflow-hidden rounded-md border bg-muted"
            >
              {m.media_type === "photo" ? (
                m.url ? (
                  <img src={m.url} alt="" className="h-32 w-full object-cover" />
                ) : (
                  <div className="h-32" />
                )
              ) : m.url ? (
                <video src={m.url} className="h-32 w-full object-cover" controls />
              ) : (
                <div className="h-32" />
              )}
              <button
                type="button"
                onClick={() => handleDelete(m)}
                className="absolute right-1 top-1 rounded bg-background/90 p-1 text-destructive opacity-0 transition group-hover:opacity-100"
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
