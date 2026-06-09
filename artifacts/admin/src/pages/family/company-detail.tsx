import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useFamilyStore, InsurancePolicy, PolicyProductType } from "@/lib/family-store";
import { ArrowLeft, Plus, ChevronRight, FileText, Bot, BookOpen, Pencil, Trash2 } from "lucide-react";

const PRODUCT_TYPE_LABELS: Record<PolicyProductType, string> = {
  motor:  "Motor",
  health: "Health",
  life:   "Life",
  travel: "Travel",
  home:   "Home",
  other:  "Other",
};
const PRODUCT_TYPE_STYLES: Record<PolicyProductType, string> = {
  motor:  "bg-blue-500/10 text-blue-400 border-blue-500/20",
  health: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  life:   "bg-purple-500/10 text-purple-400 border-purple-500/20",
  travel: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  home:   "bg-orange-500/10 text-orange-400 border-orange-500/20",
  other:  "bg-muted text-muted-foreground border-border",
};

export default function FamilyCompanyDetailPage({ params }: { params: { companyId: string } }) {
  const { companies, policies, agents, documents, savePolicies, isLoaded } = useFamilyStore();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const company = companies.find(c => c.id === params.companyId);
  const companyPolicies = policies.filter(p => p.companyId === params.companyId);
  const docCountByPolicy = documents.reduce<Record<string, number>>((acc, d) => {
    acc[d.policyId] = (acc[d.policyId] ?? 0) + 1;
    return acc;
  }, {});
  const agentCountByPolicy = agents.reduce<Record<string, number>>((acc, a) => {
    if (a.policyId) acc[a.policyId] = (acc[a.policyId] ?? 0) + 1;
    return acc;
  }, {});

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<InsurancePolicy | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [productType, setProductType] = useState<PolicyProductType>("motor");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setProductType("motor");
    setShowModal(true);
  }

  function openEdit(p: InsurancePolicy) {
    setEditing(p);
    setName(p.name);
    setDescription(p.description ?? "");
    setProductType(p.productType);
    setShowModal(true);
  }

  function savePolicy() {
    if (!name.trim() || !company) return;
    if (editing) {
      savePolicies(policies.map(p =>
        p.id === editing.id
          ? { ...p, name: name.trim(), description: description.trim(), productType, updatedAt: new Date().toISOString() }
          : p
      ));
      toast({ title: "Policy updated" });
    } else {
      const newPolicy: InsurancePolicy = {
        id: `pol-${Date.now()}`,
        companyId: company.id,
        companyName: company.name,
        name: name.trim(),
        description: description.trim() || undefined,
        productType,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      savePolicies([...policies, newPolicy]);
      toast({ title: "Policy created" });
    }
    setShowModal(false);
  }

  function deletePolicy(id: string) {
    savePolicies(policies.filter(p => p.id !== id));
    setDeleteId(null);
    toast({ title: "Policy deleted" });
  }

  if (!isLoaded) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!company) {
    return (
      <div className="space-y-4">
        <Link href="/family/companies">
          <Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" /> Back</Button>
        </Link>
        <p className="text-muted-foreground">Company not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/family/companies">
          <button className="hover:text-foreground transition-colors">Companies</button>
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">{company.name}</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold shrink-0"
            style={{ backgroundColor: company.logoColor }}
          >
            {company.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
            <p className="text-sm text-muted-foreground capitalize">{company.category} insurance</p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Policy
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Policies",  value: companyPolicies.length, icon: FileText },
          { label: "Documents", value: companyPolicies.reduce((s, p) => s + (docCountByPolicy[p.id] ?? 0), 0), icon: BookOpen },
          { label: "Agents",    value: agents.filter(a => a.companyId === params.companyId).length, icon: Bot },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className="h-7 w-7 text-muted-foreground opacity-40 shrink-0" />
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Policies</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {companyPolicies.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <FileText className="h-8 w-8 text-muted-foreground opacity-30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-3">No policies yet. Add the first policy for this company.</p>
              <Button size="sm" onClick={openCreate} className="gap-1">
                <Plus className="h-4 w-4" /> Add Policy
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-6 py-3 font-medium">Policy Name</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium text-right">Documents</th>
                  <th className="px-4 py-3 font-medium text-right">Agents</th>
                  <th className="px-4 py-3 font-medium text-right">Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {companyPolicies.map(policy => (
                  <tr key={policy.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-3">
                      <div>
                        <p className="font-medium">{policy.name}</p>
                        {policy.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{policy.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-xs ${PRODUCT_TYPE_STYLES[policy.productType]}`}>
                        {PRODUCT_TYPE_LABELS[policy.productType]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {docCountByPolicy[policy.id] ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {agentCountByPolicy[policy.id] ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {new Date(policy.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm" variant="ghost" className="h-7 w-7 p-0"
                          onClick={() => openEdit(policy)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(policy.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Link href={`/family/companies/${params.companyId}/policies/${policy.id}`}>
                          <Button size="sm" variant="ghost" className="gap-1 h-7 px-2 text-xs">
                            KB <ChevronRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Policy" : "Add Policy"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Policy Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Motor Insurance Renewal"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Product Type</Label>
              <Select value={productType} onValueChange={v => setProductType(v as PolicyProductType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(PRODUCT_TYPE_LABELS) as [PolicyProductType, string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description (Optional)</Label>
              <Textarea
                placeholder="Short description of what this policy covers…"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={savePolicy} disabled={!name.trim()}>
              {editing ? "Save Changes" : "Create Policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Policy?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the policy and all its knowledge base documents.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && deletePolicy(deleteId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
