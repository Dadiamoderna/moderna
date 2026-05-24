import { useState } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid     = () => Math.random().toString(36).substr(2, 9);
const now     = () => new Date().toISOString();
const fmt     = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB");

const store = {
  get: (k)    => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

const ADMIN_EMAIL    = "anthony1antoun@gmail.com";
const ADMIN_PASSWORD = "A.antoun2005";

const DEFAULT_SIZES  = ["XS","S","M","L","XL","XXL","36","37","38","39","40","41","42","43","44","One Size"];
const DEFAULT_COLORS = ["Black","White","Beige","Brown","Tan","Navy","Red","Pink","Green","Grey","Camel","Burgundy","Other"];

function useOptions() {
  const [colors, setColors] = useState(() => store.get("opt_colors") || DEFAULT_COLORS);
  const [sizes, setSizes]   = useState(() => store.get("opt_sizes")  || DEFAULT_SIZES);
  const saveColors = (c) => { setColors(c); store.set("opt_colors", c); };
  const saveSizes  = (s) => { setSizes(s);  store.set("opt_sizes",  s); };
  const addColor   = (c) => { if (c && !colors.includes(c)) saveColors([...colors, c]); };
  const removeColor= (c) => saveColors(colors.filter(x => x !== c));
  const addSize    = (s) => { if (s && !sizes.includes(s)) saveSizes([...sizes, s]); };
  const removeSize = (s) => saveSizes(sizes.filter(x => x !== s));
  return { colors, sizes, addColor, addSize, removeColor, removeSize };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function useAuth() {
  const [user,  setUser]  = useState(() => store.get("auth_user"));
  const [users, setUsers] = useState(() => store.get("auth_users") || [
    { id:"admin", email:ADMIN_EMAIL, password:ADMIN_PASSWORD, role:"admin", status:"approved", name:"Admin", shopId:null, createdAt:now() }
  ]);
  const [shops, setShops] = useState(() => store.get("shops") || []);

  const saveUsers = (u) => { setUsers(u); store.set("auth_users", u); };
  const saveShops = (s) => { setShops(s); store.set("shops", s); };

  const signUp = (email, password, name) => {
    if (users.find(u => u.email === email)) return { error: "Email already registered." };
    saveUsers([...users, { id:uid(), email, password, name, role:"user", status:"pending", shopId:null, createdAt:now() }]);
    return { success: true };
  };

  const signIn = (email, password) => {
    const u = users.find(u => u.email === email && u.password === password);
    if (!u)                     return { error: "Invalid email or password." };
    if (u.status === "pending")  return { error: "Your account is pending admin approval." };
    if (u.status === "rejected") return { error: "Your account access was declined." };
    setUser(u); store.set("auth_user", u);
    return { success: true };
  };

  const signOut = () => { setUser(null); store.set("auth_user", null); };

  // Admin: create a brand-new shop account
  const createShop = (shopName, email, password) => {
    if (users.find(u => u.email === email)) return { error: "Email already in use." };
    const shopId = uid();
    const newShop = { id: shopId, name: shopName, createdAt: now() };
    const newUser = { id: uid(), email, password, name: shopName, role:"shop", status:"approved", shopId, createdAt:now() };
    saveShops([...shops, newShop]);
    saveUsers([...users, newUser]);
    return { success: true };
  };

  const deleteShop = (shopId) => {
    saveShops(shops.filter(s => s.id !== shopId));
    saveUsers(users.filter(u => u.shopId !== shopId));
  };

  const approveUser = (id) => saveUsers(users.map(u => u.id === id ? { ...u, status:"approved" } : u));
  const rejectUser  = (id) => saveUsers(users.map(u => u.id === id ? { ...u, status:"rejected" } : u));
  const removeUser  = (id) => saveUsers(users.filter(u => u.id !== id));
  const assignShop  = (userId, shopId) => saveUsers(users.map(u => u.id === userId ? { ...u, shopId, role: shopId ? "shop" : "user" } : u));

  return { user, users, shops, signUp, signIn, signOut, createShop, deleteShop, approveUser, rejectUser, removeUser, assignShop };
}

// ─── Data ─────────────────────────────────────────────────────────────────────
// Inventory variant shape:
//   { color, size, shopQtys: { [shopId]: number } }
// stockAtShop = shopQtys[shopId] + transfersIn - transfersOut - shopSales
function useData() {
  const [inventory, setInventory] = useState(() => store.get("inv_global") || []);
  const [allSales,  setAllSales]  = useState(() => store.get("sales_all")  || []);
  const [transfers, setTransfers] = useState(() => store.get("transfers")   || []);

  const saveInv       = (d) => { setInventory(d); store.set("inv_global", d); };
  const saveSales     = (d) => { setAllSales(d);  store.set("sales_all",  d); };
  const saveTransfers = (d) => { setTransfers(d); store.set("transfers",  d); };

  const addItem    = (item) => saveInv([...inventory, { ...item, id:uid(), addedAt:now() }]);
  const updateItem = (id, updates) => saveInv(inventory.map(i => i.id === id ? { ...i, ...updates } : i));
  const deleteItem = (id)   => saveInv(inventory.filter(i => i.id !== id));

  // Total stock remaining for a variant across ALL shops (for global view)
  const stockByVariant = (itemId, color, size) => {
    const item = inventory.find(i => i.id === itemId);
    if (!item) return 0;
    const v = (item.variants||[]).find(v => v.color===color && v.size===size);
    if (!v) return 0;
    const totalAdded = Object.values(v.shopQtys||{}).reduce((a,q)=>a+q,0);
    const sold = allSales.filter(s=>s.itemId===itemId&&s.color===color&&s.size===size&&s.status==="completed").reduce((a,s)=>a+s.quantity,0);
    return totalAdded - sold;
  };

  // Stock at a specific shop = initial allocation + transfers in - transfers out - shop sales
  const stockAtShop = (shopId, itemId, color, size) => {
    const item = inventory.find(i => i.id === itemId);
    if (!item) return 0;
    const v = (item.variants||[]).find(v => v.color===color && v.size===size);
    const initial      = v?.shopQtys?.[shopId] || 0;
    const transfersIn  = transfers.filter(t=>t.toShopId===shopId&&t.itemId===itemId&&t.color===color&&t.size===size).reduce((a,t)=>a+t.quantity,0);
    const transfersOut = transfers.filter(t=>t.fromShopId===shopId&&t.itemId===itemId&&t.color===color&&t.size===size).reduce((a,t)=>a+t.quantity,0);
    const shopSold     = allSales.filter(s=>s.shopId===shopId&&s.itemId===itemId&&s.color===color&&s.size===size&&s.status==="completed").reduce((a,s)=>a+s.quantity,0);
    return initial + transfersIn - transfersOut - shopSold;
  };

  const recordSale = (shopId, itemId, color, size, qty, unitPrice) => {
    const item = inventory.find(i => i.id === itemId);
    if (!item) return false;
    const rem = stockAtShop(shopId, itemId, color, size);
    if (rem < qty) return false;
    const totalCost = item.costPrice * qty;
    const totalRev  = unitPrice * qty;
    const profit    = totalRev - totalCost;
    const margin    = totalRev > 0 ? ((profit/totalRev)*100).toFixed(1) : "0";
    saveSales([{ id:uid(), shopId, itemId, itemName:item.name, color, size, quantity:qty, unitCost:item.costPrice, unitPrice, totalCost, totalRev, profit, margin, status:"completed", soldAt:now(), returnedAt:null }, ...allSales]);
    return true;
  };

  const returnSale = (id) => {
    const s = allSales.find(s=>s.id===id);
    if (!s||s.status==="returned") return;
    saveSales(allSales.map(s=>s.id===id?{...s,status:"returned",returnedAt:now()}:s));
  };

  const deleteSale = (id) => saveSales(allSales.filter(s=>s.id!==id));

  const recordTransfer = (fromShopId, toShopId, itemId, color, size, qty) => {
    const item = inventory.find(i=>i.id===itemId);
    if (!item) return false;
    const avail = stockAtShop(fromShopId, itemId, color, size);
    if (avail < qty) return false;
    saveTransfers([{ id:uid(), fromShopId, toShopId, itemId, itemName:item.name, color, size, quantity:qty, transferredAt:now() }, ...transfers]);
    return true;
  };

  const salesFor       = (shopId) => shopId ? allSales.filter(s=>s.shopId===shopId) : allSales;
  const activeSalesFor = (shopId) => salesFor(shopId).filter(s=>s.status==="completed");
  const transfersFor   = (shopId) => shopId ? transfers.filter(t=>t.fromShopId===shopId||t.toShopId===shopId) : transfers;

  const kpi = (shopId) => {
    const s      = activeSalesFor(shopId);
    const rev    = s.reduce((a,t)=>a+t.totalRev,  0);
    const cogs   = s.reduce((a,t)=>a+t.totalCost, 0);
    const profit = rev - cogs;
    return { rev, cogs, profit, margin: rev>0?((profit/rev)*100).toFixed(1):"0.0", count:s.length };
  };

  return { inventory, allSales, transfers, addItem, updateItem, deleteItem, stockByVariant, stockAtShop, recordSale, returnSale, deleteSale, salesFor, kpi, recordTransfer, transfersFor };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
const IS = {
  width:"100%", background:"#07070f", border:"1px solid #1a1a2e",
  color:"#e8e0d0", padding:"11px 13px", fontSize:12, letterSpacing:1,
  outline:"none", fontFamily:"'Courier New', monospace", boxSizing:"border-box", display:"block",
};

function Notif({ msg, type }) {
  if (!msg) return null;
  const map = { error:["#2d0a0a","#c0392b","#e74c3c"], warn:["#2d2200","#f39c12","#f39c12"], success:["#0a2d16","#27ae60","#2ecc71"] };
  const [bg,border,color] = map[type] || map.success;
  return <div style={{ position:"fixed",top:20,right:20,zIndex:9999,background:bg,border:`1px solid ${border}`,color,padding:"12px 22px",fontSize:12,letterSpacing:1,fontFamily:"'Courier New', monospace",borderRadius:2,maxWidth:360,animation:"slideIn .2s ease" }}>{msg}</div>;
}

function useNotif() {
  const [n, setN] = useState(null);
  const notify = (msg, type="success") => { setN({ msg, type }); setTimeout(() => setN(null), 3200); };
  return [n, notify];
}

function Confirm({ text, sub, onConfirm, onCancel }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New', monospace" }}>
      <div style={{ background:"#0d0d1a",border:"1px solid #e74c3c",padding:"36px 40px",textAlign:"center",maxWidth:340 }}>
        <div style={{ fontSize:13,color:"#e8e0d0",marginBottom:8,letterSpacing:1 }}>{text}</div>
        <div style={{ fontSize:11,color:"#555",marginBottom:24,letterSpacing:1 }}>{sub}</div>
        <div style={{ display:"flex",gap:12,justifyContent:"center" }}>
          <button onClick={onCancel}  style={{ background:"none",border:"1px solid #333",color:"#666",padding:"8px 20px",cursor:"pointer",fontSize:11,letterSpacing:1,fontFamily:"inherit" }}>CANCEL</button>
          <button onClick={onConfirm} style={{ background:"#e74c3c",border:"none",color:"#fff",padding:"8px 20px",cursor:"pointer",fontSize:11,letterSpacing:1,fontFamily:"inherit" }}>CONFIRM</button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color="#f0e8d8", sub }) {
  return (
    <div style={{ border:"1px solid #111",padding:"18px 16px",background:"#0a0a14" }}>
      <div style={{ fontSize:9,letterSpacing:3,color:"#333",marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:18,fontWeight:"bold",color }}>{value}</div>
      {sub && <div style={{ fontSize:10,color:"#444",marginTop:3 }}>{sub}</div>}
    </div>
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ signIn, signUp }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email:"", password:"", name:"" });
  const [ok,   setOk]   = useState(null);
  const [n, notify]     = useNotif();

  const handle = () => {
    if (mode === "login") {
      const r = signIn(form.email, form.password);
      if (r.error) notify(r.error, "error");
    } else {
      if (!form.name||!form.email||!form.password) return notify("All fields required.", "error");
      if (form.password.length < 6) return notify("Password min 6 characters.", "error");
      const r = signUp(form.email, form.password, form.name);
      if (r.error) notify(r.error, "error");
      else { setOk("Account created! Awaiting admin approval."); setMode("login"); }
    }
  };

  return (
    <div style={{ minHeight:"100vh",background:"#07070f",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New', monospace" }}>
      <Notif {...(n||{})} />
      <div style={{ position:"fixed",inset:0,backgroundImage:"linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px)",backgroundSize:"44px 44px",pointerEvents:"none" }}/>
      <div style={{ position:"relative",width:400,background:"#0d0d1a",border:"1px solid #1a1a2e",padding:"48px 40px" }}>
        <div style={{ textAlign:"center",marginBottom:36 }}>
          <div style={{ fontSize:10,letterSpacing:6,color:"#333",marginBottom:8 }}>INVENTORY SYSTEM</div>
          <div style={{ fontSize:28,fontWeight:"bold",color:"#f0e8d8",letterSpacing:3 }}>STOCKROOM</div>
          <div style={{ width:40,height:2,background:"#e94560",margin:"12px auto 0" }}/>
        </div>
        {ok && <div style={{ background:"#0a2d16",border:"1px solid #27ae60",color:"#2ecc71",padding:"12px 16px",fontSize:12,marginBottom:20,letterSpacing:1 }}>✓ {ok}</div>}
        <div style={{ display:"flex",marginBottom:28,background:"#07070f",border:"1px solid #1a1a2e" }}>
          {["login","signup"].map(m => (
            <button key={m} onClick={()=>{ setMode(m); setOk(null); }} style={{ flex:1,padding:"10px",background:mode===m?"#e94560":"transparent",color:mode===m?"#fff":"#555",border:"none",cursor:"pointer",fontSize:11,letterSpacing:2,textTransform:"uppercase",fontFamily:"inherit" }}>
              {m==="login"?"Sign In":"Sign Up"}
            </button>
          ))}
        </div>
        {mode==="signup" && <input placeholder="Full Name" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} style={{...IS,marginBottom:12}}/>}
        <input placeholder="Email"    value={form.email}    onChange={e=>setForm(p=>({...p,email:e.target.value}))}    style={{...IS,marginBottom:12}} type="email"/>
        <input placeholder="Password" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} style={{...IS,marginBottom:16}} type="password" onKeyDown={e=>e.key==="Enter"&&handle()}/>
        <button onClick={handle} style={{ width:"100%",background:"#e94560",color:"#fff",border:"none",padding:"14px",fontSize:11,letterSpacing:3,cursor:"pointer",fontFamily:"inherit",fontWeight:"bold" }}>
          {mode==="login"?"SIGN IN":"REQUEST ACCESS"}
        </button>
        {mode==="signup" && <div style={{ fontSize:10,color:"#333",textAlign:"center",marginTop:16,letterSpacing:1,lineHeight:1.6 }}>New accounts require admin approval.</div>}
      </div>
    </div>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel({ users, shops, approveUser, rejectUser, removeUser, assignShop, createShop, deleteShop, colors, sizes, addColor, addSize, removeColor, removeSize, onClose }) {
  const [tab,      setTab]      = useState("shops");
  const [shopForm, setShopForm] = useState({ name:"", email:"", password:"" });
  const [newColor, setNewColor] = useState("");
  const [newSize,  setNewSize]  = useState("");
  const [n, notify]             = useNotif();
  const [confirm,  setConfirm]  = useState(null);

  const pending  = users.filter(u => u.status==="pending");
  const approved = users.filter(u => u.status==="approved" && u.role!=="admin");
  const rejected = users.filter(u => u.status==="rejected");

  const handleCreateShop = () => {
    const { name, email, password } = shopForm;
    if (!name||!email||!password) return notify("All fields required.", "error");
    if (password.length < 6)      return notify("Password min 6 characters.", "error");
    const r = createShop(name, email, password);
    if (r.error) notify(r.error, "error");
    else { notify(`Shop "${name}" created.`); setShopForm({ name:"", email:"", password:"" }); }
  };

  const Btn = ({ label, color, onClick }) => (
    <button onClick={onClick} style={{ background:"none",border:`1px solid ${color}`,color,padding:"5px 12px",fontSize:9,letterSpacing:1,cursor:"pointer",fontFamily:"inherit" }}>{label}</button>
  );

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.9)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New', monospace" }}>
      <Notif {...(n||{})} />
      {confirm && <Confirm text={confirm.text} sub={confirm.sub} onConfirm={confirm.fn} onCancel={()=>setConfirm(null)}/>}
      <div style={{ background:"#0d0d1a",border:"1px solid #1a1a2e",padding:"36px",width:640,maxHeight:"86vh",overflowY:"auto" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24 }}>
          <div>
            <div style={{ fontSize:9,letterSpacing:4,color:"#444",marginBottom:4 }}>ADMIN</div>
            <div style={{ fontSize:17,color:"#f0e8d8",letterSpacing:2 }}>MANAGEMENT PANEL</div>
          </div>
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#444",fontSize:20,cursor:"pointer" }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex",gap:0,marginBottom:28,borderBottom:"1px solid #1a1a2e" }}>
          {[["shops","SHOPS"],["users","USERS"],["pending",`PENDING ${pending.length>0?`(${pending.length})`:""}`],["options","OPTIONS"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} style={{ background:"none",border:"none",borderBottom:tab===t?"2px solid #e94560":"2px solid transparent",color:tab===t?"#e94560":"#444",padding:"8px 18px",fontSize:10,letterSpacing:2,cursor:"pointer",fontFamily:"inherit",marginBottom:-1 }}>{l}</button>
          ))}
        </div>

        {/* ── SHOPS TAB ── */}
        {tab==="shops" && (
          <div>
            {/* Create shop form */}
            <div style={{ border:"1px solid #111",padding:"20px",marginBottom:24,background:"#0a0a14" }}>
              <div style={{ fontSize:9,letterSpacing:3,color:"#444",marginBottom:14 }}>CREATE NEW SHOP</div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12 }}>
                <input placeholder="Shop Name *" value={shopForm.name}     onChange={e=>setShopForm(p=>({...p,name:e.target.value}))}     style={{...IS,marginBottom:0}}/>
                <input placeholder="Email *"     value={shopForm.email}    onChange={e=>setShopForm(p=>({...p,email:e.target.value}))}    style={{...IS,marginBottom:0}} type="email"/>
                <input placeholder="Password *"  value={shopForm.password} onChange={e=>setShopForm(p=>({...p,password:e.target.value}))} style={{...IS,marginBottom:0}} type="password"/>
              </div>
              <button onClick={handleCreateShop} style={{ background:"#e8e0d0",color:"#07070f",border:"none",padding:"9px 20px",fontSize:10,letterSpacing:2,cursor:"pointer",fontFamily:"inherit",fontWeight:"bold" }}>+ CREATE SHOP</button>
            </div>

            {/* Shop list */}
            <div style={{ fontSize:9,letterSpacing:3,color:"#444",marginBottom:12 }}>EXISTING SHOPS ({shops.length})</div>
            {shops.length===0 ? <div style={{ fontSize:12,color:"#222",letterSpacing:1 }}>No shops created yet.</div> :
              shops.map(shop => {
                const shopUser = users.find(u => u.shopId===shop.id);
                return (
                  <div key={shop.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",border:"1px solid #1a1a2e",marginBottom:8,background:"#0a0a14" }}>
                    <div>
                      <div style={{ fontSize:13,color:"#e8e0d0",fontWeight:"bold" }}>{shop.name}</div>
                      <div style={{ fontSize:10,color:"#444",marginTop:3 }}>{shopUser?.email || "—"} · Created {fmtDate(shop.createdAt)}</div>
                    </div>
                    <Btn label="DELETE SHOP" color="#e74c3c" onClick={()=>setConfirm({ text:`DELETE "${shop.name}"?`, sub:"This removes the shop and its user account.", fn:()=>{ deleteShop(shop.id); setConfirm(null); notify(`Shop deleted.`,"warn"); } })}/>
                  </div>
                );
              })
            }
          </div>
        )}

        {/* ── USERS TAB ── */}
        {tab==="users" && (
          <div>
            <div style={{ fontSize:9,letterSpacing:3,color:"#444",marginBottom:12 }}>APPROVED USERS ({approved.length})</div>
            {approved.length===0 ? <div style={{ fontSize:12,color:"#222",letterSpacing:1 }}>None.</div> :
              approved.map(u => (
                <div key={u.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",border:"1px solid #1a1a2e",marginBottom:6,background:"#0a0a14" }}>
                  <div>
                    <div style={{ fontSize:12,color:"#e8e0d0" }}>{u.name} <span style={{ fontSize:10,color:"#e94560" }}>{u.role==="shop"?"· SHOP":""}</span></div>
                    <div style={{ fontSize:10,color:"#444",marginTop:2 }}>{u.email}</div>
                  </div>
                  <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                    <select value={u.shopId||""} onChange={e=>assignShop(u.id,e.target.value||null)} style={{...IS,width:130,padding:"5px 8px",fontSize:10,marginBottom:0}}>
                      <option value="">No shop</option>
                      {shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <Btn label="REMOVE" color="#e74c3c" onClick={()=>setConfirm({ text:`REMOVE "${u.name}"?`, sub:"This cannot be undone.", fn:()=>{ removeUser(u.id); setConfirm(null); } })}/>
                  </div>
                </div>
              ))
            }
            <div style={{ fontSize:9,letterSpacing:3,color:"#444",marginBottom:12,marginTop:24 }}>REJECTED ({rejected.length})</div>
            {rejected.map(u=>(
              <div key={u.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",border:"1px solid #1a1a2e",marginBottom:6,background:"#0a0a14",opacity:0.5 }}>
                <div>
                  <div style={{ fontSize:12,color:"#e8e0d0" }}>{u.name}</div>
                  <div style={{ fontSize:10,color:"#444",marginTop:2 }}>{u.email}</div>
                </div>
                <div style={{ display:"flex",gap:8 }}>
                  <Btn label="APPROVE" color="#27ae60" onClick={()=>approveUser(u.id)}/>
                  <Btn label="DELETE"  color="#444"    onClick={()=>removeUser(u.id)}/>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── PENDING TAB ── */}
        {tab==="pending" && (
          <div>
            <div style={{ fontSize:9,letterSpacing:3,color:"#444",marginBottom:12 }}>PENDING APPROVAL ({pending.length})</div>
            {pending.length===0 ? <div style={{ fontSize:12,color:"#222",letterSpacing:1 }}>No pending requests.</div> :
              pending.map(u=>(
                <div key={u.id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",border:"1px solid #1a1a2e",marginBottom:8,background:"#0a0a14" }}>
                  <div>
                    <div style={{ fontSize:12,color:"#e8e0d0" }}>{u.name}</div>
                    <div style={{ fontSize:10,color:"#444",marginTop:2 }}>{u.email} · {fmtDate(u.createdAt)}</div>
                  </div>
                  <div style={{ display:"flex",gap:8 }}>
                    <Btn label="APPROVE" color="#27ae60" onClick={()=>approveUser(u.id)}/>
                    <Btn label="REJECT"  color="#e74c3c" onClick={()=>rejectUser(u.id)}/>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* ── OPTIONS TAB ── */}
        {tab==="options" && (
          <div>
            {/* Colors */}
            <div style={{ border:"1px solid #111",padding:"20px",marginBottom:24,background:"#0a0a14" }}>
              <div style={{ fontSize:9,letterSpacing:3,color:"#444",marginBottom:14 }}>COLORS ({colors.length})</div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:8,marginBottom:16 }}>
                {colors.map(c=>(
                  <div key={c} style={{ display:"flex",alignItems:"center",gap:6,background:"#07070f",border:"1px solid #1a1a2e",padding:"5px 12px",fontSize:11 }}>
                    <span style={{ color:"#e8e0d0" }}>{c}</span>
                    <button onClick={()=>removeColor(c)} style={{ background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:12,padding:"0 2px",fontFamily:"inherit" }} onMouseEnter={e=>e.target.style.color="#e74c3c"} onMouseLeave={e=>e.target.style.color="#444"}>✕</button>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex",gap:10 }}>
                <input placeholder="New color name" value={newColor} onChange={e=>setNewColor(e.target.value)} style={{...IS,marginBottom:0,flex:1}} onKeyDown={e=>{ if(e.key==="Enter"&&newColor.trim()){ addColor(newColor.trim()); setNewColor(""); notify(`Color "${newColor.trim()}" added.`); } }}/>
                <button onClick={()=>{ if(newColor.trim()){ addColor(newColor.trim()); notify(`Color "${newColor.trim()}" added.`); setNewColor(""); } else notify("Enter a color name.","error"); }} style={{ background:"#e8e0d0",color:"#07070f",border:"none",padding:"8px 18px",fontSize:10,letterSpacing:2,cursor:"pointer",fontFamily:"inherit",fontWeight:"bold" }}>+ ADD COLOR</button>
              </div>
            </div>

            {/* Sizes */}
            <div style={{ border:"1px solid #111",padding:"20px",background:"#0a0a14" }}>
              <div style={{ fontSize:9,letterSpacing:3,color:"#444",marginBottom:14 }}>SIZES ({sizes.length})</div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:8,marginBottom:16 }}>
                {sizes.map(s=>(
                  <div key={s} style={{ display:"flex",alignItems:"center",gap:6,background:"#07070f",border:"1px solid #1a1a2e",padding:"5px 12px",fontSize:11 }}>
                    <span style={{ color:"#e8e0d0" }}>{s}</span>
                    <button onClick={()=>removeSize(s)} style={{ background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:12,padding:"0 2px",fontFamily:"inherit" }} onMouseEnter={e=>e.target.style.color="#e74c3c"} onMouseLeave={e=>e.target.style.color="#444"}>✕</button>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex",gap:10 }}>
                <input placeholder="New size name" value={newSize} onChange={e=>setNewSize(e.target.value)} style={{...IS,marginBottom:0,flex:1}} onKeyDown={e=>{ if(e.key==="Enter"&&newSize.trim()){ addSize(newSize.trim()); setNewSize(""); notify(`Size "${newSize.trim()}" added.`); } }}/>
                <button onClick={()=>{ if(newSize.trim()){ addSize(newSize.trim()); notify(`Size "${newSize.trim()}" added.`); setNewSize(""); } else notify("Enter a size name.","error"); }} style={{ background:"#e8e0d0",color:"#07070f",border:"none",padding:"8px 18px",fontSize:10,letterSpacing:2,cursor:"pointer",fontFamily:"inherit",fontWeight:"bold" }}>+ ADD SIZE</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
function AdminDashboard({ kpi, inventory, shops }) {
  const total  = kpi(null);
  const invVal = inventory.reduce((a,i) => a + i.costPrice*i.quantity, 0);

  return (
    <div>
      <div style={{ fontSize:10,letterSpacing:4,color:"#333",marginBottom:22 }}>COMBINED OVERVIEW</div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24 }}>
        <KpiCard label="TOTAL REVENUE"   value={fmt(total.rev)}    />
        <KpiCard label="COST OF GOODS"   value={fmt(total.cogs)}   color="#555"/>
        <KpiCard label="NET PROFIT"      value={fmt(total.profit)} color={total.profit>=0?"#27ae60":"#e74c3c"}/>
        <KpiCard label="INVENTORY VALUE" value={fmt(invVal)}       color="#f39c12"/>
      </div>

      <div style={{ border:`1px solid ${total.profit>=0?"#0d3320":"#330d0d"}`,background:total.profit>=0?"#071a10":"#1a0707",padding:"20px 26px",marginBottom:28,display:"flex",alignItems:"center",gap:18 }}>
        <div style={{ fontSize:32 }}>{total.profit>=0?"▲":"▼"}</div>
        <div>
          <div style={{ fontSize:9,letterSpacing:3,color:"#444",marginBottom:5 }}>OVERALL P&L</div>
          <div style={{ fontSize:15,color:total.profit>=0?"#27ae60":"#e74c3c",fontWeight:"bold",letterSpacing:2 }}>
            {total.profit>=0?`IN THE POSITIVE — ${fmt(total.profit)}`:`IN THE NEGATIVE — ${fmt(total.profit)}`}
          </div>
          {total.rev>0&&<div style={{ fontSize:10,color:"#444",marginTop:3 }}>Overall margin: {total.margin}% · {total.count} active transactions</div>}
        </div>
      </div>

      {shops.length>0 && (
        <>
          <div style={{ fontSize:10,letterSpacing:4,color:"#333",marginBottom:16 }}>PER SHOP BREAKDOWN</div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14 }}>
            {shops.map(shop => {
              const k = kpi(shop.id);
              return (
                <div key={shop.id} style={{ border:"1px solid #1a1a2e",padding:"18px",background:"#09091a" }}>
                  <div style={{ fontSize:10,letterSpacing:3,color:"#e94560",marginBottom:14 }}>{shop.name.toUpperCase()}</div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                    <KpiCard label="REVENUE" value={fmt(k.rev)}/>
                    <KpiCard label="PROFIT"  value={fmt(k.profit)} color={k.profit>=0?"#27ae60":"#e74c3c"}/>
                    <KpiCard label="MARGIN"  value={`${k.margin}%`} color={parseFloat(k.margin)>=0?"#27ae60":"#e74c3c"} sub={`${k.count} sales`}/>
                    <KpiCard label="COGS"    value={fmt(k.cogs)} color="#555"/>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {shops.length===0 && total.count===0 && (
        <div style={{ textAlign:"center",padding:"60px 0",color:"#222",fontSize:11,letterSpacing:3 }}>NO SHOPS CREATED YET — GO TO ADMIN PANEL TO ADD SHOPS</div>
      )}
    </div>
  );
}

// ─── Inventory Manager (admin only) ──────────────────────────────────────────
function InventoryManager({ inventory, addItem, updateItem, deleteItem, stockByVariant, stockAtShop, shops, colors, sizes }) {
  const [form,     setForm]     = useState({ name:"", sku:"", costPrice:"", category:"" });
  const [editingId, setEditingId] = useState(null);
  // variants: [{ color, size, shopQtys: { shopId: "" } }]
  const makeBlankVariant = () => ({ color: colors[0]||"Black", size: sizes[0]||"M", shopQtys: Object.fromEntries(shops.map(s=>[s.id,""])) });
  const [variants, setVariants] = useState(() => [makeBlankVariant()]);
  const [search,   setSearch]   = useState("");
  const [n, notify]             = useNotif();
  const [confirm,  setConfirm]  = useState(null);

  const addVariant    = () => setVariants(v=>[...v, makeBlankVariant()]);
  const removeVariant = (i) => setVariants(v=>v.filter((_,j)=>j!==i));
  const updVar        = (i,k,val) => setVariants(v=>v.map((r,j)=>j===i?{...r,[k]:val}:r));
  const updShopQty    = (i,shopId,val) => setVariants(v=>v.map((r,j)=>j===i?{...r,shopQtys:{...r.shopQtys,[shopId]:val}}:r));

  const resetForm = () => {
    setForm({ name:"", sku:"", costPrice:"", category:"" });
    setVariants([makeBlankVariant()]);
    setEditingId(null);
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setForm({ name:item.name, sku:item.sku||"", costPrice:String(item.costPrice), category:item.category||"" });
    const editVariants = (item.variants||[]).map(v => ({
      color: v.color,
      size: v.size,
      shopQtys: Object.fromEntries(shops.map(s=>[s.id, String(v.shopQtys?.[s.id]||"")]))
    }));
    setVariants(editVariants.length > 0 ? editVariants : [makeBlankVariant()]);
  };

  const handleSave = () => {
    if (!form.name||!form.costPrice) return notify("Name and cost price required.", "error");
    if (shops.length===0) return notify("Create at least one shop first.", "error");
    for (const v of variants) {
      const total = Object.values(v.shopQtys).reduce((a,q)=>a+(parseInt(q)||0),0);
      if (total<=0) return notify("Each variant needs at least 1 unit across shops.", "error");
    }
    const builtVariants = variants.map(v=>({
      color: v.color,
      size:  v.size,
      shopQtys: Object.fromEntries(Object.entries(v.shopQtys).map(([sid,q])=>[sid,parseInt(q)||0]))
    }));
    const totalQty = builtVariants.reduce((a,v)=>a+Object.values(v.shopQtys).reduce((b,q)=>b+q,0),0);

    if (editingId) {
      updateItem(editingId, { ...form, costPrice:parseFloat(form.costPrice), quantity:totalQty, variants:builtVariants });
      notify(`"${form.name}" updated.`);
    } else {
      addItem({ ...form, costPrice:parseFloat(form.costPrice), quantity:totalQty, variants:builtVariants });
      notify(`"${form.name}" added.`);
    }
    resetForm();
  };

  const filtered = inventory.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.sku||"").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <Notif {...(n||{})} />
      {confirm && <Confirm text="REMOVE THIS ITEM?" sub="Cannot be undone." onConfirm={()=>{ deleteItem(confirm); setConfirm(null); notify("Item removed."); }} onCancel={()=>setConfirm(null)}/>}

      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:22 }}>
        <div style={{ fontSize:10,letterSpacing:4,color:"#333" }}>INVENTORY ({inventory.length})</div>
        <input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} style={{...IS,width:200,marginBottom:0}}/>
      </div>

      {/* Add/Edit form */}
      <div style={{ border:`1px solid ${editingId?"#e94560":"#111"}`,padding:"24px",marginBottom:28,background:"#0a0a14" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
          <div style={{ fontSize:9,letterSpacing:3,color:editingId?"#e94560":"#444" }}>{editingId?"EDIT ITEM":"ADD NEW ITEM"}</div>
          {editingId&&<button onClick={resetForm} style={{ background:"none",border:"1px solid #1a1a2e",color:"#555",padding:"5px 14px",fontSize:9,letterSpacing:1,cursor:"pointer",fontFamily:"inherit" }}>CANCEL EDIT</button>}
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:10,marginBottom:16 }}>
          {[["name","Item Name *"],["sku","SKU"],["costPrice","Cost Price ($) *"],["category","Category"]].map(([k,p])=>(
            <input key={k} placeholder={p} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{...IS,marginBottom:0}}/>
          ))}
        </div>

        <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:10 }}>VARIANTS — COLOR / SIZE / QTY PER SHOP</div>
        {shops.length===0 && <div style={{ fontSize:11,color:"#e74c3c",marginBottom:12,letterSpacing:1 }}>⚠ Create shops first before adding inventory.</div>}

        {variants.map((v,i)=>(
          <div key={i} style={{ border:"1px solid #1a1a2e",padding:"14px",marginBottom:10,background:"#07070f" }}>
            <div style={{ display:"grid",gridTemplateColumns:`1fr 1fr ${shops.map(()=>"80px").join(" ")} 32px`,gap:8,alignItems:"center" }}>
              <select value={v.color} onChange={e=>updVar(i,"color",e.target.value)} style={{...IS,marginBottom:0}}>
                {colors.map(c=><option key={c}>{c}</option>)}
              </select>
              <select value={v.size}  onChange={e=>updVar(i,"size",e.target.value)}  style={{...IS,marginBottom:0}}>
                {sizes.map(s=><option key={s}>{s}</option>)}
              </select>
              {shops.map(s=>(
                <div key={s.id}>
                  <div style={{ fontSize:8,letterSpacing:1,color:"#e94560",marginBottom:4,textAlign:"center",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{s.name}</div>
                  <input type="number" min="0" placeholder="0" value={v.shopQtys[s.id]||""} onChange={e=>updShopQty(i,s.id,e.target.value)} style={{...IS,marginBottom:0,textAlign:"center",padding:"8px 4px"}}/>
                </div>
              ))}
              {variants.length>1 && <button onClick={()=>removeVariant(i)} style={{ background:"none",border:"1px solid #2a1010",color:"#555",cursor:"pointer",fontSize:14,padding:"4px",fontFamily:"inherit",marginTop:18 }}>✕</button>}
            </div>
          </div>
        ))}

        <div style={{ display:"flex",gap:10,marginTop:12 }}>
          <button onClick={addVariant} style={{ background:"none",border:"1px solid #1a1a2e",color:"#555",padding:"8px 16px",fontSize:10,letterSpacing:1,cursor:"pointer",fontFamily:"inherit" }}>+ ADD VARIANT</button>
          <button onClick={handleSave}  style={{ background:editingId?"#e94560":"#e8e0d0",color:editingId?"#fff":"#07070f",border:"none",padding:"8px 22px",fontSize:10,letterSpacing:2,cursor:"pointer",fontFamily:"inherit",fontWeight:"bold" }}>{editingId?"SAVE CHANGES":"+ ADD TO INVENTORY"}</button>
        </div>
      </div>

      {/* Item list */}
      {filtered.length>0 ? filtered.map(item=>{
        const totalStock = (item.variants||[]).reduce((a,v)=>a+stockByVariant(item.id,v.color,v.size),0);
        return (
          <div key={item.id} style={{ border:"1px solid #111",marginBottom:14,background:"#0a0a14" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",borderBottom:"1px solid #111" }}>
              <div>
                <span style={{ fontSize:13,color:"#e8e0d0",fontWeight:"bold" }}>{item.name}</span>
                {item.sku&&<span style={{ fontSize:10,color:"#444",marginLeft:12 }}>{item.sku}</span>}
                {item.category&&<span style={{ fontSize:10,color:"#555",marginLeft:8 }}>· {item.category}</span>}
              </div>
              <div style={{ display:"flex",alignItems:"center",gap:14 }}>
                <span style={{ fontSize:11,color:"#888" }}>{fmt(item.costPrice)} cost</span>
                <span style={{ fontSize:12,fontWeight:"bold",color:totalStock===0?"#e74c3c":totalStock<5?"#f39c12":"#27ae60" }}>{totalStock} total</span>
                <button onClick={()=>startEdit(item)} style={{ background:"none",border:"1px solid #1a1a2e",color:"#555",cursor:"pointer",fontSize:9,letterSpacing:1,padding:"4px 10px",fontFamily:"inherit" }} onMouseEnter={e=>e.target.style.color="#e94560"} onMouseLeave={e=>e.target.style.color="#555"}>EDIT</button>
                <button onClick={()=>setConfirm(item.id)} style={{ background:"none",border:"none",color:"#2a2a3a",cursor:"pointer",fontSize:16 }} onMouseEnter={e=>e.target.style.color="#e74c3c"} onMouseLeave={e=>e.target.style.color="#2a2a3a"}>✕</button>
              </div>
            </div>
            {/* Variant breakdown per shop */}
            <div style={{ padding:"12px 18px" }}>
              {(item.variants||[]).map((v,vi)=>{
                const total=stockByVariant(item.id,v.color,v.size);
                return (
                  <div key={vi} style={{ marginBottom:8 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:16,flexWrap:"wrap" }}>
                      <span style={{ fontSize:11,color:"#888",minWidth:120 }}>{v.color} / {v.size}</span>
                      {shops.map(s=>{
                        const shopStock=stockAtShop(s.id,item.id,v.color,v.size);
                        return (
                          <div key={s.id} style={{ background:"#07070f",border:"1px solid #1a1a2e",padding:"5px 12px",fontSize:10,display:"flex",gap:8,alignItems:"center" }}>
                            <span style={{ color:"#555" }}>{s.name}:</span>
                            <span style={{ color:shopStock<=0?"#e74c3c":shopStock<5?"#f39c12":"#27ae60",fontWeight:"bold" }}>{shopStock}</span>
                          </div>
                        );
                      })}
                      <div style={{ background:"#07070f",border:"1px solid #333",padding:"5px 12px",fontSize:10,display:"flex",gap:8 }}>
                        <span style={{ color:"#555" }}>Total:</span>
                        <span style={{ color:total<=0?"#e74c3c":total<5?"#f39c12":"#27ae60",fontWeight:"bold" }}>{total}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }) : (
        <div style={{ textAlign:"center",padding:"60px 0",color:"#222",fontSize:11,letterSpacing:3 }}>{search?"NO MATCHING ITEMS":"INVENTORY EMPTY"}</div>
      )}
    </div>
  );
}

// ─── Stock View (all shops — readable by shop users) ─────────────────────────
function StockView({ inventory, stockByVariant, stockAtShop, shops, currentShopId }) {
  const [search,    setSearch]    = useState("");
  const [shopFilter, setShopFilter] = useState(currentShopId || "all");

  const filtered = inventory.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.sku||"").toLowerCase().includes(search.toLowerCase())
  );

  const stockOf = (itemId, color, size) => {
    if (shopFilter === "all") return stockByVariant(itemId, color, size);
    return stockAtShop(shopFilter, itemId, color, size);
  };

  const activeShop = shops.find(s => s.id === shopFilter);

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22,flexWrap:"wrap",gap:10 }}>
        <div style={{ fontSize:10,letterSpacing:4,color:"#333" }}>STOCK LEVELS — {shopFilter==="all"?"ALL LOCATIONS":(activeShop?.name||"").toUpperCase()}</div>
        <div style={{ display:"flex",gap:10,alignItems:"center" }}>
          <select value={shopFilter} onChange={e=>setShopFilter(e.target.value)} style={{...IS,width:160,marginBottom:0}}>
            <option value="all">All Shops</option>
            {shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input placeholder="Search items..." value={search} onChange={e=>setSearch(e.target.value)} style={{...IS,width:200,marginBottom:0}}/>
        </div>
      </div>

      {filtered.length===0 ? (
        <div style={{ textAlign:"center",padding:"60px 0",color:"#222",fontSize:11,letterSpacing:3 }}>NO ITEMS IN INVENTORY</div>
      ) : filtered.map(item=>{
        const totalStock = (item.variants||[]).reduce((a,v)=>a+stockOf(item.id,v.color,v.size),0);
        return (
          <div key={item.id} style={{ border:"1px solid #111",marginBottom:14,background:"#0a0a14" }}>
            <div style={{ padding:"14px 18px",borderBottom:"1px solid #111",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div>
                <span style={{ fontSize:13,color:"#e8e0d0",fontWeight:"bold" }}>{item.name}</span>
                {item.category&&<span style={{ fontSize:10,color:"#555",marginLeft:10 }}>· {item.category}</span>}
              </div>
              <div style={{ fontSize:11,fontWeight:"bold",color:totalStock===0?"#e74c3c":totalStock<5?"#f39c12":"#27ae60" }}>
                {totalStock} {shopFilter==="all"?"total":"at "+(activeShop?.name||"shop")} remaining
              </div>
            </div>
            <div style={{ padding:"12px 18px",display:"flex",flexWrap:"wrap",gap:8 }}>
              {(item.variants||[]).map((v,i)=>{
                const rem=stockOf(item.id,v.color,v.size);
                if (shopFilter !== "all" && rem <= 0) return null;
                return (
                  <div key={i} style={{ background:"#07070f",border:`1px solid ${rem===0?"#330d0d":rem<5?"#332200":"#1a1a2e"}`,padding:"8px 14px",fontSize:11,minWidth:140 }}>
                    <div style={{ color:"#666",marginBottom:4,fontSize:10 }}>{v.color} / {v.size}</div>
                    <div style={{ color:rem===0?"#e74c3c":rem<5?"#f39c12":"#27ae60",fontWeight:"bold",fontSize:13 }}>
                      {rem===0?"OUT OF STOCK":`${rem} left`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sell View ────────────────────────────────────────────────────────────────
function SellView({ shopId, inventory, stockAtShop, recordSale }) {
  const [form, setForm] = useState({ itemId:"", color:"", size:"", quantity:"", salePrice:"" });
  const [n, notify]     = useNotif();

  const item       = inventory.find(i=>i.id===form.itemId);
  const colors     = item ? [...new Set((item.variants||[]).map(v=>v.color))] : [];
  const sizes      = item&&form.color ? (item.variants||[]).filter(v=>v.color===form.color).map(v=>v.size) : [];
  const remaining  = item&&form.color&&form.size ? stockAtShop(shopId,form.itemId,form.color,form.size) : null;

  const preview = (() => {
    if (!item||!form.quantity||!form.salePrice) return null;
    const qty=parseInt(form.quantity), price=parseFloat(form.salePrice);
    if (isNaN(qty)||isNaN(price)||qty<=0) return null;
    const cost=item.costPrice*qty, rev=price*qty, profit=rev-cost;
    return { cost, rev, profit, margin: rev>0?((profit/rev)*100).toFixed(1):"0" };
  })();

  const handle = () => {
    const { itemId, color, size, quantity, salePrice } = form;
    if (!itemId||!color||!size||!quantity||!salePrice) return notify("Fill in all fields.", "error");
    const qty=parseInt(quantity), price=parseFloat(salePrice);
    if (isNaN(qty)||isNaN(price)||qty<=0||price<0) return notify("Invalid values.", "error");
    if (remaining!==null&&qty>remaining) return notify(`Only ${remaining} in stock for this variant.`, "error");
    const ok = recordSale(shopId, itemId, color, size, qty, price);
    if (ok) { notify("Sale recorded!"); setForm({ itemId:"", color:"", size:"", quantity:"", salePrice:"" }); }
    else notify("Not enough stock.", "error");
  };

  return (
    <div>
      <Notif {...(n||{})} />
      <div style={{ fontSize:10,letterSpacing:4,color:"#333",marginBottom:24 }}>RECORD A SALE</div>
      <div style={{ border:"1px solid #111",padding:"32px",maxWidth:520,background:"#0a0a14" }}>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>ITEM *</div>
          <select value={form.itemId} onChange={e=>setForm(f=>({...f,itemId:e.target.value,color:"",size:""}))} style={{...IS,marginBottom:0}}>
            <option value="">— Select item —</option>
            {inventory.map(i=><option key={i.id} value={i.id}>{i.name}{i.sku?` (${i.sku})`:""}</option>)}
          </select>
        </div>
        {colors.length>0&&(
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14 }}>
            <div>
              <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>COLOR *</div>
              <select value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value,size:""}))} style={{...IS,marginBottom:0}}>
                <option value="">— Color —</option>
                {colors.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>SIZE *</div>
              <select value={form.size} onChange={e=>setForm(f=>({...f,size:e.target.value}))} style={{...IS,marginBottom:0}} disabled={!form.color}>
                <option value="">— Size —</option>
                {sizes.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
        )}
        {remaining!==null&&(
          <div style={{ fontSize:11,color:remaining===0?"#e74c3c":remaining<5?"#f39c12":"#27ae60",marginBottom:14,letterSpacing:1 }}>
            {remaining===0?"⚠ OUT OF STOCK":`${remaining} available`}
          </div>
        )}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16 }}>
          {[["quantity","QTY SOLD *"],["salePrice","UNIT PRICE ($) *"]].map(([k,p])=>(
            <div key={k}>
              <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>{p}</div>
              <input type="number" min="0" placeholder="0" value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{...IS,marginBottom:0}}/>
            </div>
          ))}
        </div>
        {preview&&(
          <div style={{ background:"#07070f",border:`1px solid ${preview.profit>=0?"#0d3320":"#330d0d"}`,padding:"14px",marginBottom:18 }}>
            <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:10 }}>PREVIEW</div>
            {[["Revenue",fmt(preview.rev),"#e8e0d0"],["Cost",fmt(preview.cost),"#555"],["Profit",fmt(preview.profit),preview.profit>=0?"#27ae60":"#e74c3c"],["Margin",`${preview.margin}%`,preview.profit>=0?"#27ae60":"#e74c3c"]].map(([l,v,c])=>(
              <div key={l} style={{ display:"flex",justifyContent:"space-between",marginBottom:5 }}>
                <span style={{ fontSize:10,color:"#444" }}>{l}</span>
                <span style={{ fontSize:12,color:c,fontWeight:l==="Profit"?"bold":"normal" }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={handle} style={{ width:"100%",background:"#e94560",color:"#fff",border:"none",padding:"14px",fontSize:10,letterSpacing:3,cursor:"pointer",fontFamily:"inherit",fontWeight:"bold" }}>RECORD SALE</button>
      </div>
    </div>
  );
}


// ─── Transfer View ────────────────────────────────────────────────────────────
function TransferView({ shops, inventory, stockByVariant, stockAtShop, recordTransfer, transfersFor, currentShopId, isAdmin }) {
  const [form, setForm] = useState({ fromShopId:"", toShopId:"", itemId:"", color:"", size:"", quantity:"" });
  const [n, notify]     = useNotif();

  const item      = inventory.find(i => i.id === form.itemId);
  const colors    = item ? [...new Set((item.variants||[]).map(v=>v.color))] : [];
  const sizes     = item&&form.color ? (item.variants||[]).filter(v=>v.color===form.color).map(v=>v.size) : [];
  const available = item&&form.color&&form.size&&form.fromShopId
    ? (isAdmin
        ? stockAtShop(form.fromShopId, form.itemId, form.color, form.size)
        : stockAtShop(currentShopId,   form.itemId, form.color, form.size))
    : null;

  const fromId = isAdmin ? form.fromShopId : currentShopId;

  const handle = () => {
    const toId  = form.toShopId;
    const qty   = parseInt(form.quantity);
    if (!fromId||!toId)            return notify("Select source and destination shops.", "error");
    if (fromId===toId)             return notify("Source and destination must differ.", "error");
    if (!form.itemId||!form.color||!form.size) return notify("Select item, color and size.", "error");
    if (!qty||qty<=0)              return notify("Enter a valid quantity.", "error");
    if (available!==null&&qty>available) return notify(`Only ${available??0} available at source.`, "error");
    const ok = recordTransfer(fromId, toId, form.itemId, form.color, form.size, qty);
    if (ok) {
      const fromName = shops.find(s=>s.id===fromId)?.name||"Warehouse";
      const toName   = shops.find(s=>s.id===toId)?.name||"?";
      notify(`Transferred ${qty} × ${item.name} (${form.color}/${form.size}) → ${toName}`);
      setForm(f=>({ ...f, toShopId:"", itemId:"", color:"", size:"", quantity:"" }));
    } else notify("Transfer failed. Check stock.", "error");
  };

  const history = transfersFor(isAdmin ? null : currentShopId);

  return (
    <div>
      <Notif {...(n||{})} />
      <div style={{ fontSize:10,letterSpacing:4,color:"#333",marginBottom:24 }}>STOCK TRANSFER</div>

      <div style={{ border:"1px solid #111",padding:"28px",maxWidth:580,background:"#0a0a14",marginBottom:32 }}>
        <div style={{ fontSize:9,letterSpacing:3,color:"#444",marginBottom:18 }}>NEW TRANSFER</div>

        {/* From / To */}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 40px 1fr",gap:10,alignItems:"center",marginBottom:14 }}>
          <div>
            <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>FROM *</div>
            {isAdmin ? (
              <select value={form.fromShopId} onChange={e=>setForm(f=>({...f,fromShopId:e.target.value,itemId:"",color:"",size:""}))} style={{...IS,marginBottom:0}}>
                <option value="">— Shop —</option>
                {shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <div style={{...IS,marginBottom:0,color:"#e94560",border:"1px solid #e94560",padding:"10px 13px"}}>
                {shops.find(s=>s.id===currentShopId)?.name||"My Shop"}
              </div>
            )}
          </div>
          <div style={{ textAlign:"center",color:"#e94560",fontSize:18,marginTop:20 }}>→</div>
          <div>
            <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>TO *</div>
            <select value={form.toShopId} onChange={e=>setForm(f=>({...f,toShopId:e.target.value}))} style={{...IS,marginBottom:0}}>
              <option value="">— Shop —</option>
              {shops.filter(s=>s.id!==fromId).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {/* Item */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>ITEM *</div>
          <select value={form.itemId} onChange={e=>setForm(f=>({...f,itemId:e.target.value,color:"",size:""}))} style={{...IS,marginBottom:0}}>
            <option value="">— Select item —</option>
            {inventory.map(i=><option key={i.id} value={i.id}>{i.name}{i.sku?` (${i.sku})`:""}</option>)}
          </select>
        </div>

        {colors.length>0&&(
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14 }}>
            <div>
              <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>COLOR *</div>
              <select value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value,size:""}))} style={{...IS,marginBottom:0}}>
                <option value="">— Color —</option>
                {colors.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>SIZE *</div>
              <select value={form.size} onChange={e=>setForm(f=>({...f,size:e.target.value}))} style={{...IS,marginBottom:0}} disabled={!form.color}>
                <option value="">— Size —</option>
                {sizes.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
        )}

        {available!==null&&(
          <div style={{ fontSize:11,color:available<=0?"#e74c3c":available<5?"#f39c12":"#27ae60",marginBottom:14,letterSpacing:1 }}>
            {available<=0?"⚠ NONE AVAILABLE AT SOURCE":`${available} available at source`}
          </div>
        )}

        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:9,letterSpacing:2,color:"#444",marginBottom:8 }}>QUANTITY *</div>
          <input type="number" min="1" placeholder="0" value={form.quantity} onChange={e=>setForm(f=>({...f,quantity:e.target.value}))} style={{...IS,marginBottom:0,maxWidth:160}}/>
        </div>

        <button onClick={handle} style={{ background:"#e94560",color:"#fff",border:"none",padding:"12px 28px",fontSize:10,letterSpacing:3,cursor:"pointer",fontFamily:"inherit",fontWeight:"bold" }}>
          TRANSFER STOCK →
        </button>
      </div>

      {/* Transfer history */}
      <div style={{ fontSize:10,letterSpacing:4,color:"#333",marginBottom:16 }}>TRANSFER HISTORY ({history.length})</div>
      {history.length===0 ? (
        <div style={{ textAlign:"center",padding:"40px 0",color:"#222",fontSize:11,letterSpacing:3 }}>NO TRANSFERS YET</div>
      ) : (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"90px 1fr 80px 64px 56px 1fr 1fr",gap:8,paddingBottom:10,borderBottom:"1px solid #111" }}>
            {["DATE","ITEM","COLOR","SIZE","QTY","FROM","TO"].map(h=>(
              <div key={h} style={{ fontSize:9,letterSpacing:2,color:"#333" }}>{h}</div>
            ))}
          </div>
          {history.map(t=>(
            <div key={t.id} style={{ display:"grid",gridTemplateColumns:"90px 1fr 80px 64px 56px 1fr 1fr",gap:8,padding:"10px 0",borderBottom:"1px solid #0c0c18",alignItems:"center" }}>
              <div style={{ fontSize:10,color:"#444" }}>{fmtDate(t.transferredAt)}</div>
              <div style={{ fontSize:11,color:"#e8e0d0" }}>{t.itemName}</div>
              <div style={{ fontSize:10,color:"#666" }}>{t.color}</div>
              <div style={{ fontSize:10,color:"#666" }}>{t.size}</div>
              <div style={{ fontSize:11,color:"#e94560",fontWeight:"bold" }}>{t.quantity}</div>
              <div style={{ fontSize:11,color:"#555" }}>{shops.find(s=>s.id===t.fromShopId)?.name||t.fromShopId}</div>
              <div style={{ fontSize:11,color:"#27ae60" }}>{shops.find(s=>s.id===t.toShopId)?.name||t.toShopId}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sales Log ────────────────────────────────────────────────────────────────
function SalesLogView({ sales, returnSale, deleteSale, kpi, label }) {
  const [n, notify]  = useNotif();
  const [confirm, setConfirm] = useState(null);

  return (
    <div>
      <Notif {...(n||{})} />
      {confirm&&<Confirm text="DELETE THIS SALE?" sub="Stock is restored if not yet returned." onConfirm={()=>{ deleteSale(confirm); notify("Deleted."); setConfirm(null); }} onCancel={()=>setConfirm(null)}/>}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22 }}>
        <div style={{ fontSize:10,letterSpacing:4,color:"#333" }}>SALES — {label} ({sales.length})</div>
        <div style={{ fontSize:12,color:kpi.profit>=0?"#27ae60":"#e74c3c",fontWeight:"bold" }}>NET: {fmt(kpi.profit)}</div>
      </div>
      {sales.length>0 ? (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"86px 1fr 72px 64px 56px 1fr 1fr 1fr 76px",gap:8,paddingBottom:10,borderBottom:"1px solid #111" }}>
            {["DATE","ITEM","COLOR","SIZE","QTY","UNIT $","REVENUE","PROFIT","ACTIONS"].map(h=>(
              <div key={h} style={{ fontSize:9,letterSpacing:2,color:"#333" }}>{h}</div>
            ))}
          </div>
          {sales.map(s=>(
            <div key={s.id} style={{ display:"grid",gridTemplateColumns:"86px 1fr 72px 64px 56px 1fr 1fr 1fr 76px",gap:8,padding:"10px 0",borderBottom:"1px solid #0c0c18",alignItems:"center",opacity:s.status==="returned"?0.38:1 }}>
              <div style={{ fontSize:10,color:"#444" }}>{fmtDate(s.soldAt)}</div>
              <div>
                <div style={{ fontSize:11,color:"#e8e0d0" }}>{s.itemName}</div>
                {s.status==="returned"&&<div style={{ fontSize:9,color:"#f39c12",marginTop:1 }}>RETURNED</div>}
              </div>
              <div style={{ fontSize:10,color:"#666" }}>{s.color||"—"}</div>
              <div style={{ fontSize:10,color:"#666" }}>{s.size||"—"}</div>
              <div style={{ fontSize:11,color:"#666" }}>{s.quantity}</div>
              <div style={{ fontSize:11,color:"#666" }}>{fmt(s.unitPrice)}</div>
              <div style={{ fontSize:11,color:s.status==="returned"?"#333":"#e8e0d0",textDecoration:s.status==="returned"?"line-through":"none" }}>{fmt(s.totalRev)}</div>
              <div style={{ fontSize:12,fontWeight:"bold",color:s.status==="returned"?"#333":s.profit>=0?"#27ae60":"#e74c3c",textDecoration:s.status==="returned"?"line-through":"none" }}>{fmt(s.profit)}</div>
              <div style={{ display:"flex",gap:5 }}>
                {s.status!=="returned"&&<button onClick={()=>{ returnSale(s.id); notify("Returned. Stock restored.","warn"); }} title="Return" style={{ background:"none",border:"1px solid #2a2a00",color:"#666",padding:"3px 7px",fontSize:9,cursor:"pointer",fontFamily:"inherit" }}>↩</button>}
                <button onClick={()=>setConfirm(s.id)} title="Delete" style={{ background:"none",border:"1px solid #2a1010",color:"#555",padding:"3px 7px",fontSize:9,cursor:"pointer",fontFamily:"inherit" }}>✕</button>
              </div>
            </div>
          ))}
          <div style={{ display:"grid",gridTemplateColumns:"86px 1fr 72px 64px 56px 1fr 1fr 1fr 76px",gap:8,padding:"14px 0 0",borderTop:"1px solid #1a1a2e",marginTop:8 }}>
            <div style={{ fontSize:9,letterSpacing:2,color:"#444",gridColumn:"1/7" }}>TOTALS (ACTIVE)</div>
            <div style={{ fontSize:12,color:"#e8e0d0",fontWeight:"bold" }}>{fmt(kpi.rev)}</div>
            <div style={{ fontSize:13,color:kpi.profit>=0?"#27ae60":"#e74c3c",fontWeight:"bold" }}>{fmt(kpi.profit)}</div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign:"center",padding:"60px 0",color:"#222",fontSize:11,letterSpacing:3 }}>NO SALES YET</div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function MainApp({ user, signOut, users, shops, approveUser, rejectUser, removeUser, assignShop, createShop, deleteShop, colors, sizes, addColor, addSize, removeColor, removeSize }) {
  const data      = useData();
  const isAdmin   = user.role === "admin";
  const shopId    = user.shopId;
  const shopObj   = shops.find(s=>s.id===shopId);
  const [view, setView]         = useState("dashboard");
  const [showAdmin, setShowAdmin] = useState(false);
  const pendingCount = users.filter(u=>u.status==="pending").length;

  const adminNavs = ["dashboard","inventory","transfer","log"];
  const shopNavs  = ["sell","stock","log"];
  const navs      = isAdmin ? adminNavs : shopNavs;

  const shopSales = data.salesFor(shopId);
  const shopKpi   = data.kpi(shopId);

  return (
    <div style={{ fontFamily:"'Courier New', monospace",background:"#07070f",minHeight:"100vh",color:"#e8e0d0" }}>
      {showAdmin&&isAdmin&&(
        <AdminPanel users={users} shops={shops} approveUser={approveUser} rejectUser={rejectUser} removeUser={removeUser} assignShop={assignShop} createShop={createShop} deleteShop={deleteShop} colors={colors} sizes={sizes} addColor={addColor} addSize={addSize} removeColor={removeColor} removeSize={removeSize} onClose={()=>setShowAdmin(false)}/>
      )}

      {/* Header */}
      <div style={{ borderBottom:"1px solid #0f0f1a",padding:"0 28px",display:"flex",alignItems:"center",justifyContent:"space-between",height:54,background:"#0a0a14" }}>
        <div style={{ display:"flex",alignItems:"center",gap:18 }}>
          <div style={{ fontSize:15,fontWeight:"bold",letterSpacing:3,color:"#f0e8d8" }}>STOCKROOM</div>
          {!isAdmin&&shopObj&&<div style={{ fontSize:9,letterSpacing:2,color:"#e94560",border:"1px solid #e94560",padding:"2px 10px" }}>{shopObj.name.toUpperCase()}</div>}
          <div style={{ width:1,height:18,background:"#1a1a2e" }}/>
          {navs.map(v=>(
            <button key={v} onClick={()=>setView(v)} style={{ background:"none",border:"none",color:view===v?"#e94560":"#444",fontSize:10,letterSpacing:2,cursor:"pointer",textTransform:"uppercase",fontFamily:"inherit",borderBottom:view===v?"1px solid #e94560":"1px solid transparent",paddingBottom:2,transition:"all .15s" }}>
              {v==="log"?(isAdmin?"ALL SALES":"MY SALES"):v==="stock"?"INVENTORY":v==="transfer"?"TRANSFER":v}
            </button>
          ))}
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          {isAdmin&&(
            <button onClick={()=>setShowAdmin(true)} style={{ background:pendingCount>0?"#2d1a00":"none",border:`1px solid ${pendingCount>0?"#f39c12":"#1a1a2e"}`,color:pendingCount>0?"#f39c12":"#444",padding:"6px 14px",fontSize:9,letterSpacing:2,cursor:"pointer",fontFamily:"inherit" }}>
              MANAGE {pendingCount>0?`(${pendingCount} PENDING)`:""}
            </button>
          )}
          <div style={{ fontSize:10,color:"#333" }}>{user.email}</div>
          <button onClick={signOut} style={{ background:"none",border:"1px solid #1a1a2e",color:"#444",padding:"6px 14px",fontSize:9,letterSpacing:2,cursor:"pointer",fontFamily:"inherit" }}>SIGN OUT</button>
        </div>
      </div>

      <div style={{ padding:"28px",maxWidth:1200,margin:"0 auto" }}>
        {isAdmin && view==="dashboard"  && <AdminDashboard kpi={data.kpi} inventory={data.inventory} shops={shops}/>}
        {isAdmin && view==="inventory"  && <InventoryManager inventory={data.inventory} addItem={data.addItem} updateItem={data.updateItem} deleteItem={data.deleteItem} stockByVariant={data.stockByVariant} stockAtShop={data.stockAtShop} shops={shops} colors={colors} sizes={sizes}/>}
        {isAdmin && view==="transfer"   && <TransferView shops={shops} inventory={data.inventory} stockByVariant={data.stockByVariant} stockAtShop={data.stockAtShop} recordTransfer={data.recordTransfer} transfersFor={data.transfersFor} currentShopId={shopId} isAdmin={true}/>}
        {isAdmin && view==="log"        && <SalesLogView sales={data.allSales} returnSale={data.returnSale} deleteSale={data.deleteSale} kpi={data.kpi(null)} label="ALL SHOPS"/>}

        {!isAdmin && view==="sell"  && <SellView shopId={shopId} inventory={data.inventory} stockAtShop={data.stockAtShop} recordSale={data.recordSale}/>}
        {!isAdmin && view==="stock" && <StockView inventory={data.inventory} stockByVariant={data.stockByVariant} stockAtShop={data.stockAtShop} shops={shops} currentShopId={shopId}/>}
        {!isAdmin && view==="log"   && <SalesLogView sales={shopSales} returnSale={data.returnSale} deleteSale={data.deleteSale} kpi={shopKpi} label={(shopObj?.name||"MY SHOP").toUpperCase()}/>}
      </div>

      <style>{`
        *{box-sizing:border-box;}
        input::placeholder{color:#333;}
        select{color:#e8e0d0;}
        select option{background:#0d0d1a;}
        @keyframes slideIn{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-track{background:#07070f;}
        ::-webkit-scrollbar-thumb{background:#1a1a2e;}
      `}</style>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const auth = useAuth();
  const opts = useOptions();
  const { user, signUp, signIn, signOut, users, shops, approveUser, rejectUser, removeUser, assignShop, createShop, deleteShop } = auth;

  if (!user) return <AuthScreen signIn={signIn} signUp={signUp}/>;

  if (user.status==="pending") return (
    <div style={{ minHeight:"100vh",background:"#07070f",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New', monospace" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:36,marginBottom:18 }}>⏳</div>
        <div style={{ fontSize:14,letterSpacing:3,marginBottom:10,color:"#e8e0d0" }}>ACCESS PENDING</div>
        <div style={{ fontSize:11,color:"#444",marginBottom:24,letterSpacing:1 }}>Waiting for admin approval.</div>
        <button onClick={signOut} style={{ background:"none",border:"1px solid #1a1a2e",color:"#555",padding:"10px 24px",cursor:"pointer",fontSize:10,letterSpacing:2,fontFamily:"inherit" }}>SIGN OUT</button>
      </div>
    </div>
  );

  return <MainApp user={user} signOut={signOut} users={users} shops={shops} approveUser={approveUser} rejectUser={rejectUser} removeUser={removeUser} assignShop={assignShop} createShop={createShop} deleteShop={deleteShop} colors={opts.colors} sizes={opts.sizes} addColor={opts.addColor} addSize={opts.addSize} removeColor={opts.removeColor} removeSize={opts.removeSize}/>;
}
