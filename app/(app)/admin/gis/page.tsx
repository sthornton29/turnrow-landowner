import { redirect } from "next/navigation";

// The GIS registry lives in the Settings page's Admin section now.
export default function AdminGisRedirect() {
  redirect("/settings");
}
