import { SectionLoading } from "@/components/Loading";

// The tender header and step tabs stay on screen; only the step content waits.
export default function Loading() {
  return <SectionLoading label="Loading this step" />;
}
