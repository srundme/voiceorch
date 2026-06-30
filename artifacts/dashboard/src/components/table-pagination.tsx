import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface TablePaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export function TablePagination({
  page,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className = "",
}: TablePaginationProps) {
  const [jumpInput, setJumpInput] = useState("");

  function handleJump() {
    const n = parseInt(jumpInput, 10);
    if (!isNaN(n)) onPageChange(Math.min(Math.max(n, 1), totalPages));
    setJumpInput("");
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
        <span>Rows per page</span>
        <Select value={String(pageSize)} onValueChange={v => { onPageSizeChange(Number(v)); onPageChange(1); }}>
          <SelectTrigger className="h-7 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map(s => (
              <SelectItem key={s} value={String(s)}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon" className="h-7 w-7"
          disabled={page <= 1} onClick={() => onPageChange(page - 1)}
          aria-label="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground/70 whitespace-nowrap tabular-nums min-w-[80px] text-center">
          Page {page} of {totalPages}
        </span>
        <Button variant="outline" size="icon" className="h-7 w-7"
          disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}
          aria-label="Next page">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Input
          type="number" min={1} max={totalPages} placeholder="Go to"
          className="h-7 w-16 text-xs"
          value={jumpInput}
          onChange={e => setJumpInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleJump(); } }}
        />
        <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={handleJump}>Go</Button>
      </div>

      {totalItems !== undefined && (
        <span className="text-[10px] text-muted-foreground/40 ml-auto">
          {totalItems.toLocaleString()} total
        </span>
      )}
    </div>
  );
}
