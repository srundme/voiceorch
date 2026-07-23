import { useState, useEffect, useRef } from "react";
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
  Database, Plus, Trash2, Search, Image as ImageIcon, Upload, Loader2, Sparkles, CheckCircle2, FileSpreadsheet, Link as LinkIcon, Download, Layers, ShieldCheck, Car, ShoppingBag, UserCheck, HardDrive
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

// 1-Click Industry Schema Templates
const PRESET_SCHEMAS = [
  {
    id: "ecommerce",
    name: "E-Commerce Orders & Returns",
    icon: ShoppingBag,
    color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    columns: [
      { key: "invoice_no", label: "Invoice Number", type: "text" as const },
      { key: "customer_phone", label: "Customer Phone", type: "text" as const },
      { key: "product_name", label: "Product Name", type: "text" as const },
      { key: "sku_barcode", label: "SKU Barcode", type: "text" as const },
      { key: "expected_photo", label: "Expected Product Photo", type: "image" as const },
    ],
  },
  {
    id: "insurance",
    name: "Vehicle & Insurance Claims",
    icon: Car,
    color: "text-sky-400 border-sky-500/30 bg-sky-500/10",
    columns: [
      { key: "policy_no", label: "Policy Number", type: "text" as const },
      { key: "license_plate", label: "License Plate", type: "text" as const },
      { key: "owner_name", label: "Owner Name", type: "text" as const },
      { key: "vehicle_model", label: "Vehicle Model", type: "text" as const },
      { key: "baseline_photo", label: "Baseline Vehicle Photo", type: "image" as const },
    ],
  },
  {
    id: "identity",
    name: "Employee KYC & Identity",
    icon: UserCheck,
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    columns: [
      { key: "employee_id", label: "Employee ID", type: "text" as const },
      { key: "full_name", label: "Full Name", type: "text" as const },
      { key: "department", label: "Department", type: "text" as const },
      { key: "face_photo", label: "Baseline Face Photo", type: "image" as const },
    ],
  },
  {
    id: "equipment",
    name: "Hardware & Equipment",
    icon: HardDrive,
    color: "text-purple-400 border-purple-500/30 bg-purple-500/10",
    columns: [
      { key: "serial_no", label: "Serial Number", type: "text" as const },
      { key: "model_name", label: "Equipment Model", type: "text" as const },
      { key: "location", label: "Facility Location", type: "text" as const },
      { key: "diagram_photo", label: "Reference Diagram Photo", type: "image" as const },
    ],
  },
];

export function CustomDatabaseBuilder({ defaultAgentId }: { defaultAgentId?: number }) {
  const { toast } = useToast();
  const { data: agents } = useListAgents();
  const [databases, setDatabases] = useState<CustomDatabase[]>([]);
  const [selectedDb, setSelectedDb] = useState<CustomDatabase | null>(null);
  const [rows, setRows] = useState<CustomDatabaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const [columns, setColumns] = useState<CustomColumnDef[]>(PRESET_SCHEMAS[0]!.columns);

  // Add Row Modal State
  const [showAddRowModal, setShowAddRowModal] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, string>>({});
  const [newRowPhotoUrl, setNewRowPhotoUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);

  // CSV Import State
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importingCsv, setImportingCsv] = useState(false);

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

  const applyPresetSchema = (presetId: string) => {
    const found = PRESET_SCHEMAS.find((s) => s.id === presetId);
    if (found) {
      setTableName(found.name);
      setColumns([...found.columns]);
      toast({ title: "Template Applied", description: `Configured columns for ${found.name}` });
    }
  };

  const handleAddColumn = () => {
    const key = `col_${columns.length + 1}`;
    setColumns([...columns, { key, label: `New Column ${columns.length + 1}`, type: "text" }]);
  };

  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const b64 = (reader.result as string) || "";
        setNewRowPhotoUrl(b64);
        setUploadingImage(false);
        toast({ title: "Image Uploaded", description: "Reference photo ready." });
      };
      reader.readAsDataURL(file);
    } catch {
      setUploadingImage(false);
      toast({ title: "Upload Failed", variant: "destructive" });
    }
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
        toast({ title: "Custom Database Created", description: `Database ${tableName} created and bound to Vision AI.` });
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
        toast({ title: "Record Saved", description: "Ground-truth record & reference photo added." });
        setShowAddRowModal(false);
        setNewRowData({});
        setNewRowPhotoUrl("");
        void fetchRows(selectedDb.id);
      }
    } catch {
      toast({ title: "Error", description: "Failed to add record", variant: "destructive" });
    }
  };

  const handleImportCsv = async () => {
    if (!selectedDb || !csvText.trim()) return;
    setImportingCsv(true);
    try {
      const lines = csvText.trim().split("\n");
      if (lines.length < 2) {
        toast({ title: "Invalid CSV", description: "CSV must have a header row and at least 1 data row.", variant: "destructive" });
        setImportingCsv(false);
        return;
      }
      const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
      const rowsToInsert = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
        const record: Record<string, string> = {};
        headers.forEach((h, idx) => {
          record[h.toLowerCase().replace(/\s+/g, "_")] = vals[idx] || "";
        });
        return { data: record };
      });

      const res = await fetch(`/api/custom-databases/${selectedDb.id}/bulk-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToInsert }),
      });

      if (res.ok) {
        toast({ title: "CSV Import Success", description: `Successfully imported ${rowsToInsert.length} records.` });
        setShowCsvModal(false);
        setCsvText("");
        void fetchRows(selectedDb.id);
      }
    } catch {
      toast({ title: "Import Failed", variant: "destructive" });
    } finally {
      setImportingCsv(false);
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl border border-border/40 bg-card/30">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Database className="h-4 w-4 text-primary" /> Reference Product &amp; Invoice Database
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Store reference product photos, invoices, or barcodes for Vision AI to verify live on calls.
          </p>
        </div>

        <Button
          onClick={() => setShowCreateModal(true)}
          size="sm"
          className="h-8 text-xs font-semibold gap-1.5 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" /> Create Custom Table
        </Button>
      </div>

      {/* Database Selector Pills */}
      {databases.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {databases.map((dbItem) => (
            <button
              key={dbItem.id}
              onClick={() => setSelectedDb(dbItem)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-medium shrink-0 transition-all flex items-center gap-2 ${
                selectedDb?.id === dbItem.id
                  ? "bg-card text-foreground border-border/80 shadow-sm"
                  : "bg-muted/20 border-border/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{dbItem.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Selected Table Data View */}
      {selectedDb && (
        <div className="rounded-2xl border border-border/60 bg-card/30 p-5 space-y-4 shadow-sm">
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
                variant="outline"
                onClick={() => setShowCsvModal(true)}
                className="h-8 text-xs border-border/60 hover:bg-card/60 gap-1 shrink-0"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" /> Import CSV
              </Button>

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
                      No records found in this table. Click &quot;Add Record&quot; or &quot;Import CSV&quot; to populate.
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
                          <div className="flex items-center gap-2">
                            <img src={r.referenceImageUrls[0]} alt="Ref" className="h-7 w-7 rounded object-cover border border-border/60" />
                            <a href={r.referenceImageUrls[0]} target="_blank" rel="noreferrer" className="text-[11px] text-sky-400 hover:underline">
                              View Full Image
                            </a>
                          </div>
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

      {/* Modal 1: Create Database with 1-Click Schemas */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Database className="h-4 w-4 text-sky-400" /> Create Custom Table
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select a 1-click industry schema template or customize your own table columns.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 1-Click Industry Preset Schemas */}
            <div>
              <Label className="text-xs font-bold mb-2 block">1-Click Industry Schema Templates</Label>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_SCHEMAS.map((preset) => {
                  const Icon = preset.icon;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPresetSchema(preset.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 ${preset.color} hover:opacity-90`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <div>
                        <p className="text-xs font-bold">{preset.name}</p>
                        <p className="text-[10px] opacity-80">{preset.columns.length} pre-configured columns</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

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

      {/* Modal 2: Add Row Record with File Upload */}
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
              <Label className="text-xs font-bold">Reference Product / Document Photo</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleImageFileUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-8 text-xs gap-1.5 border-dashed"
                >
                  {uploadingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 text-sky-400" />}
                  Upload Image File
                </Button>

                {newRowPhotoUrl && (
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Image Attached
                  </Badge>
                )}
              </div>
              <Input
                placeholder="Or paste image URL (https://...)"
                value={newRowPhotoUrl}
                onChange={(e) => setNewRowPhotoUrl(e.target.value)}
                className="mt-2 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button size="sm" onClick={handleAddRow} className="bg-sky-500 hover:bg-sky-400 text-black font-bold text-xs">
              Save Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 3: CSV Bulk Import */}
      <Dialog open={showCsvModal} onOpenChange={setShowCsvModal}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-400" /> Import CSV Records
            </DialogTitle>
            <DialogDescription className="text-xs">
              Paste CSV text with column headers matching your table.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Textarea
              placeholder={`invoice_no,customer_phone,product_name,expected_photo\nINV-9841,+919797154325,Blue Denim Jacket,https://...\nINV-9842,+919876543210,Black Leather Jacket,https://...`}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="h-44 text-xs font-mono bg-background/50"
            />
          </div>

          <DialogFooter>
            <Button
              size="sm"
              disabled={importingCsv || !csvText.trim()}
              onClick={handleImportCsv}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs"
            >
              {importingCsv ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
              Import Records
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
