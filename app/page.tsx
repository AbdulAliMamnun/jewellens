import CatalogWorkspace from "@/components/CatalogWorkspace";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-baseline gap-3 px-6 py-5">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            {APP_NAME}
          </h1>
          <p className="text-sm text-zinc-500">{APP_TAGLINE}</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <CatalogWorkspace />
      </main>
    </div>
  );
}
