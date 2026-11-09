import { loadPlan } from "@/lib/plan/load";
import { PageTitle } from "../_c/ui";
import { LibrarySearch } from "./LibrarySearch";

export default function Library() {
  const ex = loadPlan().exercises;
  const list = Object.entries(ex).map(([key, e]) => ({ key, name: e.name, category: e.category, purpose: e.purpose, equipment: e.equipment }));
  return (
    <>
      <PageTitle title="Exercise library" sub="How to do every exercise in your plan." back="/more" />
      <LibrarySearch list={list} />
    </>
  );
}
