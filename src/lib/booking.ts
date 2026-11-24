import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { notifyNewBooking } from "@/lib/notify";

const BookingSchema = z
  .object({
    kind: z.enum(["private", "org"]).default("private"),
    name: z.string().trim().min(1).max(120),
    contact: z.string().trim().max(180).optional().default(""),
    instagram: z.string().trim().max(80).optional().default(""),
    email: z.string().trim().max(120).optional().default(""),
    placement: z.string().trim().max(80).optional().default(""),
    size: z.string().trim().max(80).optional().default(""),
    styles: z.string().trim().max(160).optional().default(""),
    idea: z.string().trim().max(2000).optional().default(""),
    city: z.string().trim().max(80).optional().default(""),
    whenLabel: z.string().trim().max(80).optional().default(""),
    budget: z.string().trim().max(80).optional().default(""),
    orgName: z.string().trim().max(160).optional().default(""),
    orgFormat: z.string().trim().max(120).optional().default(""),
    people: z.string().trim().max(40).optional().default(""),
    flashId: z.string().trim().max(40).optional().default(""),
    sessionFormat: z.string().trim().max(40).optional().default(""),
    lang: z.string().trim().max(8).optional().default("en"),
    hp: z.string().optional().default(""),
  })
  .transform((data) => {
    const contact = data.contact || data.instagram || data.email;
    return { ...data, contact };
  })
  .refine((data) => data.name.length >= 1 && data.contact.length >= 1, {
    message: "Fill in name and a contact (phone, email or Instagram).",
    path: ["contact"],
  });

export type BookingInput = z.infer<typeof BookingSchema>;

function humanError(err: unknown): Error {
  if (err instanceof z.ZodError) {
    return new Error("Fill in name and a contact (phone, email or Instagram).");
  }
  if (err instanceof Error) return err;
  return new Error("Could not save the request. Open Instagram Direct instead.");
}

export const submitBooking = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const parsed = BookingSchema.safeParse(data);
    if (!parsed.success) throw humanError(parsed.error);
    return parsed.data;
  })
  .handler(async ({ data }) => {
    if (data.hp && data.hp.length > 0) {
      return { ok: true as const, skipped: true, delivered: true };
    }

    let skipped = false;
    try {
      const sql = await getSql();
      await sql`
        insert into bookings (
          kind, name, contact, instagram, email, placement, size, styles, idea,
          city, when_label, budget, org_name, org_format, people, flash_id, lang
        ) values (
          ${data.kind}, ${data.name}, ${data.contact}, ${data.instagram}, ${data.email},
          ${data.placement}, ${data.size}, ${data.styles}, ${data.idea}, ${data.city},
          ${data.whenLabel}, ${data.budget}, ${data.orgName}, ${data.orgFormat},
          ${data.people}, ${data.flashId}, ${data.lang}
        )
      `;
    } catch (err) {
      console.error("[booking] database unavailable, continue via Instagram Direct", err);
      skipped = true;
    }

    let delivered = false;
    try {
      delivered = await notifyNewBooking(data);
    } catch (err) {
      console.error("[booking] notify failed", err);
    }

    return { ok: true as const, skipped, delivered };
  });

export function buildTelegramText(data: BookingInput): string {
  const lines =
    data.kind === "org"
      ? [
          "ORG / COLLAB · NAMENLOS",
          "------------",
          `Company: ${data.orgName || data.name}`,
          `Contact: ${data.contact}`,
          `Format: ${data.orgFormat || "-"}`,
          `People: ${data.people || "-"}`,
          `City: ${data.city || "-"}`,
          `When: ${data.whenLabel || "-"}`,
          `Budget: ${data.budget || "-"}`,
          "",
          "Brief:",
          data.idea || "-",
        ]
      : [
          "PRIVATE BOOKING · NAMENLOS",
          "------------",
          `Name: ${data.name}`,
          `Contact: ${data.contact}`,
          `IG: ${data.instagram || "-"}`,
          `Place: ${data.placement || "-"}`,
          `Size: ${data.size || "-"}`,
          `Style: ${data.styles || "-"}`,
          `When: ${data.whenLabel || "-"}`,
          `Budget: ${data.budget || "-"}`,
          `Format: ${data.sessionFormat || "-"}`,
          data.flashId ? `Flash: ${data.flashId}` : "",
          "",
          "Idea:",
          data.idea || "-",
        ];
  return lines.filter(Boolean).join("\n");
}
