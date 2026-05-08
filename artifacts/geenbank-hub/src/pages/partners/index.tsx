import { useState } from "react";
import { useListPartners, getListPartnersQueryKey, useCreatePartner, useUpdatePartner } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Edit2, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function PartnersAdmin() {
  const { data: partners, isLoading } = useListPartners({ query: { queryKey: getListPartnersQueryKey() } });
  const createMutation = useCreatePartner();
  const updateMutation = useUpdatePartner();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    contactEmail: "",
    productFocus: "",
    minimumTicketSize: "",
    maximumTicketSize: "",
    activeStatus: "active",
    notes: ""
  });

  const handleOpenDialog = (partner?: any) => {
    if (partner) {
      setEditingId(partner.id);
      setFormData({
        name: partner.name,
        contactEmail: partner.contactEmail,
        productFocus: partner.productFocus,
        minimumTicketSize: partner.minimumTicketSize?.toString() || "",
        maximumTicketSize: partner.maximumTicketSize?.toString() || "",
        activeStatus: partner.activeStatus,
        notes: partner.notes || ""
      });
    } else {
      setEditingId(null);
      setFormData({
        name: "", contactEmail: "", productFocus: "", minimumTicketSize: "", maximumTicketSize: "", activeStatus: "active", notes: ""
      });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      name: formData.name,
      contactEmail: formData.contactEmail,
      productFocus: formData.productFocus,
      minimumTicketSize: formData.minimumTicketSize ? Number(formData.minimumTicketSize) : undefined,
      maximumTicketSize: formData.maximumTicketSize ? Number(formData.maximumTicketSize) : undefined,
      activeStatus: formData.activeStatus,
      notes: formData.notes
    };

    if (editingId) {
      updateMutation.mutate({ partnerId: editingId, data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Partner gewijzigd" });
        }
      });
    } else {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
          setIsDialogOpen(false);
          toast({ title: "Partner toegevoegd" });
        }
      });
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight mb-1">Partner Financiers</h1>
          <p className="text-muted-foreground">Beheer de alternatieve financiers in het netwerk.</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="w-4 h-4 mr-2" /> Nieuwe Partner
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {partners?.map(partner => (
            <Card key={partner.id} className="relative overflow-hidden group">
              <div className={`absolute top-0 left-0 w-1 h-full ${partner.activeStatus === 'active' ? 'bg-green-500' : 'bg-muted'}`} />
              <CardContent className="p-5">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold truncate max-w-[150px]">{partner.name}</h3>
                      <Badge variant="outline" className="text-[10px] uppercase font-bold mt-1 tracking-wider">
                        {partner.activeStatus}
                      </Badge>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 h-8 w-8" onClick={() => handleOpenDialog(partner)}>
                    <Edit2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
                
                <div className="space-y-2 text-sm text-muted-foreground mb-4">
                  <div className="flex justify-between"><span className="font-medium text-foreground">Focus:</span> <span>{partner.productFocus}</span></div>
                  <div className="flex justify-between"><span className="font-medium text-foreground">Ticket size:</span> <span>€{partner.minimumTicketSize ? (partner.minimumTicketSize/1000)+'k' : '0'} - €{partner.maximumTicketSize ? (partner.maximumTicketSize/1000000)+'M' : '∞'}</span></div>
                  <div className="flex justify-between"><span className="font-medium text-foreground">Conversie:</span> <span>{partner.submissionsCount > 0 ? Math.round((partner.acceptedCount/partner.submissionsCount)*100) : 0}% ({partner.acceptedCount}/{partner.submissionsCount})</span></div>
                </div>
                
                <p className="text-xs text-muted-foreground truncate">{partner.contactEmail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Partner Wijzigen" : "Nieuwe Partner Toevoegen"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Naam *</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Contact E-mail *</Label>
                <Input type="email" value={formData.contactEmail} onChange={e => setFormData({...formData, contactEmail: e.target.value})} />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Product Focus *</Label>
              <Input placeholder="Bv: Factoring, MKB Leningen, Vastgoed" value={formData.productFocus} onChange={e => setFormData({...formData, productFocus: e.target.value})} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min. Ticket Size (€)</Label>
                <Input type="number" value={formData.minimumTicketSize} onChange={e => setFormData({...formData, minimumTicketSize: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Max. Ticket Size (€)</Label>
                <Input type="number" value={formData.maximumTicketSize} onChange={e => setFormData({...formData, maximumTicketSize: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.activeStatus} onValueChange={v => setFormData({...formData, activeStatus: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Actief</SelectItem>
                  <SelectItem value="inactive">Inactief</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notities</Label>
              <Textarea rows={3} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Annuleren</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending || !formData.name || !formData.contactEmail || !formData.productFocus}>
              {editingId ? "Wijzigingen Opslaan" : "Partner Aanmaken"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}