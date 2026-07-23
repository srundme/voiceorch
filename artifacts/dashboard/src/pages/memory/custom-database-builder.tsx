import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Database, Plus, Trash2, Search, Image as ImageIcon, Upload, Loader2, Sparkles, CheckCircle2, FileSpreadsheet, Link as LinkIcon
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useListAgents } from "@workspace/api-client-react";

type CustomColumnDef = {
  key: string;
  label: string;
  type: "text" | "number" | "image" | "badge" | "date";
};

type CustomDatabase = {
  id: number;
  name: string;
  description: string | null;
  agentId: number | null;
  columns: CustomColumnDef[];
  createdAt: string;
};

type CustomDatabaseRow = {
  id: number;
  databaseId: number;
  data: Record<string, any>;
  referenceImageUrls: string[];
  createdAt: string;
};

export function CustomDatabaseBuilder({ defaultAgentId }: { defaultAgentId?: number }) {
  const { toast } = useToast();
  const { data: agents } = useListAgents();
  const [databases, setDatabases] = useState<CustomDatabase[]>([]);
  const [selectedDb, setSelectedDb] = useState<CustomDatabase | null>(null);
  const [rows, setRows] = useState<CustomDatabaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Create Table Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tableName, setTableName] = useState("");
  const [tableDesc, setTableDesc] = useState("");
  const [linkedAgentId, setLinkedAgentId] = useState<string>(defaultAgentId ? String(defaultAgentId) : "none");

  useEffect(() => {
    if (defaultAgentId) {
      setLinkedAgentId(String(defaultAgentId));
    }
  }, [defaultAgentId]);

  const [columns, setColumns] = useState<CustomColumnDef[]>([
    { key: "invoice_no", label: "Invoice Number", type: "text" },
    { key: "product_name", label: "Product Name", type: "text" },
    { key: "expected_photo", label: "Expected Product Photo", type: "image" },
  ]);

  // Add Row Modal State
  const [showAddRowModal, setShowAddRowModal] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});
  const [newRowPhotoUrl, setNewRowPhotoUrl] = useState("");

  const fetchDatabases = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/custom-databases");
      if (res.ok) {
        const data = await res.json();
        setDatabases(data);
        if (data.length > 0 && !selectedDb) {
          setSelectedDb(data[0]);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const fetchRows = async (dbId: number) => {
    try {
      const res = await fetch(`/api/custom-databases/${dbId}/rows`);
      if (res.ok) setRows(await res.json());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void fetchDatabases();
  }, []);

  useEffect(() => {
    if (selectedDb) {
      void fetchRows(selectedDb.id);
    }
  }, [selectedDb]);

  const handleAddColumn = () => {
    const key = `col_${columns.length + 1}`;
    setColumns([...columns, { key, label: `New Column ${columns.length + 1}`, type: "text" }]);
  };

  const handleCreateDatabase = async () => {
    if (!tableName.trim()) return;
    try {
      const res = await fetch("/api/custom-databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tableName.trim(),
          description: tableDesc.trim() || undefined,
          agentId: linkedAgentId !== "none" ? parseInt(linkedAgentId, 10) : undefined,
          columns,
        }),
      });
      if (res.ok) {
        toast({ title: "Custom Database Created", description: `Database ${tableName} is now ready and linked to Vision AI.` });
        setShowCreateModal(false);
        setTableName("");
        setTableDesc("");
        void fetchDatabases();
      }
    } catch {
      toast({ title: "Error", description: "Failed to create database", variant: "destructive" });
    }
  };

  const handleAddRow = async () => {
    if (!selectedDb) return;
    try {
      const res = await fetch(`/api/custom-databases/${selectedDb.id}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: newRowData,
          referenceImageUrls: newRowPhotoUrl.trim() ? [newRowPhotoUrl.trim()] : [],
        }),
      });
      if (res.ok) {
        toast({ title: "Record Added", description: "Reference data & image saved successfully." });
        setShowAddRowModal(false);
        setNewRowData({});
        setNewRowPhotoUrl("");
        void fetchRows(selectedDb.id);
      }
    } catch {
      toast({ title: "Error", description: "Failed to add record", variant: "destructive" });
    }
  };

  const handleDeleteRow = async (rowId: number) => {
    if (!selectedDb) return;
    try {
      const res = await fetch(`/api/custom-databases/${selectedDb.id}/rows/${rowId}`, { method: "DELETE" });
      if (res.ok) {
        setRows(rows.filter((r) => r.id !== rowId));
        toast({ title: "Record Deleted" });
      }
    } catch {
      /* ignore */
    }
  };

  const filteredRows = rows.filter((r) => {
    if (!searchQuery.trim()) return true;
    return JSON.stringify(r.data).toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-muted/20 p-4 rounded-2xl border border-border/50">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2 text-foreground">
            <Database className="h-4 w-4 text-sky-400" /> Dynamic Synthetic Database Builder
          </h2>
          <p className="text-xs text-muted-foreground">
            Create no-code custom databases with reference product images for Vision AI to verify wrong shipments, invoices, or barcodes.
          </p>
        </div>

        <Button
          onClick={() => setShowCreateModal(true)}
          className="bg-sky-500 hover:bg-sky-400 text-black font-bold text-xs gap-1.5 shadow-md shadow-sky-950/20"
        >
          <Plus className="h-4 w-4" /> Create Custom Table
        </Button>
      </div>

      {/* Database Selector Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {databases.map((dbItem) => (
          <button
            key={dbItem.id}
            onClick={() => setSelectedDb(dbItem)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold shrink-0 transition-all flex items-center gap-2 ${
              selectedDb?.id === dbItem.id
                ? "bg-sky-500/20 text-sky-300 border-sky-500/40 shadow-sm"
                : "bg-card/40 border-border/50 text-muted-foreground hover:bg-card/80"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>{dbItem.name}</span>
            {dbItem.agentId && (
              <Badge variant="outline" className="text-[8px] bg-sky-500/10 text-sky-400 border-sky-500/30 px-1">
                Linked
              </Badge>
            )}
          </button>
        ))}
      </div>

      {/* Selected Table Data View */}
      {selectedDb && (
        <div className="rounded-2xl border border-border/60 bg-card/30 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                {selectedDb.name}
              </h3>
              {selectedDb.description && <p className="text-xs text-muted-foreground">{selectedDb.description}</p>}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search records..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 text-xs bg-background/50 h-8"
                />
              </div>

              <Button
                size="sm"
                onClick={() => setShowAddRowModal(true)}
                className="h-8 text-xs bg-sky-500/10 text-sky-300 border border-sky-500/30 hover:bg-sky-500/20 gap-1 shrink-0"
              >
                <Plus className="h-3.5 w-3.5" /> Add Record
              </Button>
            </div>
          </div>

          {/* Table Data Grid */}
          <div className="border border-border/40 rounded-xl overflow-hidden bg-background/40">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-bold text-foreground">ID</TableHead>
                  {selectedDb.columns.map((col) => (
                    <TableHead key={col.key} className="text-xs font-bold text-foreground">
                      {col.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-xs font-bold text-foreground">Reference Image</TableHead>
                  <TableHead className="text-right text-xs font-bold text-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={selectedDb.columns.length + 3} className="text-center text-xs text-muted-foreground py-8">
                      No records found in this table. Click &quot;Add Record&quot; to populate your synthetic data.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/10">
                      <TableCell className="text-xs font-mono font-bold text-muted-foreground">#{r.id}</TableCell>
                      {selectedDb.columns.map((col) => (
                        <TableCell key={col.key} className="text-xs text-foreground font-medium">
                          {String(r.data[col.key] ?? "-")}
                        </TableCell>
                      ))}
                      <TableCell className="text-xs">
                        {r.referenceImageUrls.length > 0 ? (
                          <a href={r.referenceImageUrls[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-400 hover:underline">
                            <ImageIcon className="h-3.5 w-3.5" /> View Photo
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50 text-[11px]">No Photo</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteRow(r.id)}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Modal 1: Create Database */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Database className="h-4 w-4 text-sky-400" /> Create Custom Table
            </DialogTitle>
            <DialogDescription className="text-xs">
              Define table columns for products, invoices, or barcodes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Table Name *</Label>
              <Input
                placeholder="e.g. E-Commerce Product Invoices"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                className="mt-1 text-xs"
              />
            </div>

            {defaultAgentId ? (
              <div className="p-2.5 rounded-xl border border-sky-500/30 bg-sky-500/10 text-xs flex items-center justify-between">
                <span className="text-muted-foreground text-[11px]">Vision AI Binding:</span>
                <Badge className="bg-sky-500 text-black font-bold text-[10px]">
                  Auto-Linked to This Agent (#{defaultAgentId})
                </Badge>
              </div>
            ) : (
              <div>
                <Label className="text-xs">Link to Vision Agent (Optional)</Label>
                <Select value={linkedAgentId} onValueChange={setLinkedAgentId}>
                  <SelectTrigger className="mt-1 text-xs">
                    <SelectValue placeholder="Select Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (General Table)</SelectItem>
                    {(agents ?? []).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name} (ID: {a.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">Columns ({columns.length})</Label>
                <Button type="button" variant="outline" size="sm" onClick={handleAddColumn} className="h-6 text-[10px]">
                  + Add Column
                </Button>
              </div>

              {columns.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    placeholder="Column Label"
                    value={c.label}
                    onChange={(e) => {
                      const next = [...columns];
                      next[i].label = e.target.value;
                      next[i].key = e.target.value.toLowerCase().replace(/\s+/g, "_");
                      setColumns(next);
                    }}
                    className="text-xs h-8 flex-1"
                  />
                  <Select
                    value={c.type}
                    onValueChange={(val: any) => {
                      const next = [...columns];
                      next[i].type = val;
                      setColumns(next);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="image">Image URL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button size="sm" onClick={handleCreateDatabase} className="bg-sky-500 hover:bg-sky-400 text-black font-bold text-xs">
              Create Table &amp; Bind Tools
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Add Row Record */}
      <Dialog open={showAddRowModal} onOpenChange={setShowAddRowModal}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Plus className="h-4 w-4 text-sky-400" /> Add Record to {selectedDb?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {(selectedDb?.columns ?? []).map((col) => (
              <div key={col.key}>
                <Label className="text-xs">{col.label}</Label>
                <Input
                  placeholder={`Enter ${col.label}`}
                  value={newRowData[col.key] || ""}
                  onChange={(e) => setNewRowData({ ...newRowData, [col.key]: e.target.value })}
                  className="mt-1 text-xs"
                />
              </div>
            ))}

            <div>
              <Label className="text-xs">Reference Product / Document Photo URL</Label>
              <Input
                placeholder="https://example.com/photos/expected-blue-jacket.jpg"
                value={newRowPhotoUrl}
                onChange={(e) => setNewRowPhotoUrl(e.target.value)}
                className="mt-1 text-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Vision AI uses this reference image to verify if the wrong product was delivered live on call!
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button size="sm" onClick={handleAddRow} className="bg-sky-500 hover:bg-sky-400 text-black font-bold text-xs">
              Save Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
