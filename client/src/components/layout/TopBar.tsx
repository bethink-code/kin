import { CanvasMenu } from "./CanvasMenu";
import { UserMenu } from "./UserMenu";
import type { CanvasKey } from "@/lib/canvasCopy";
import type { AuthUser } from "@/hooks/useAuth";

// Three zones in the top bar:
//   [UserMenu]   [CanvasMenu pill — title | beat timeline]   [Ally wordmark]
export function TopBar({
  user,
  activeCanvas,
  onNavigateSubStep,
}: {
  user: AuthUser;
  activeCanvas: CanvasKey;
  onNavigateSubStep?: (canvas: CanvasKey, subStep: string) => void;
}) {
  return (
    <header className="border-b border-border bg-background px-6 py-6 grid grid-cols-[1fr_auto_1fr] items-center gap-6 flex-shrink-0">
      <div className="justify-self-start">
        <UserMenu user={user} />
      </div>
      <div className="justify-self-center">
        <CanvasMenu activeCanvas={activeCanvas} onNavigateSubStep={onNavigateSubStep} />
      </div>
      <div className="flex flex-col items-end leading-none justify-self-end">
        <span className="font-serif text-3xl">Ally</span>
        <span className="text-xs text-muted-foreground mt-1">your money, understood</span>
      </div>
    </header>
  );
}
