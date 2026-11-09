import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';

const ToastContext=createContext(null);

// Les notifications de l'application suivent la boîte de dialogue active :
// elles restent accessibles au clavier et ne recouvrent pas ses commandes.
export function AppToastProvider({children,items}) {
  const [dialogs,setDialogs]=useState([]);
  const register=useCallback(id=>setDialogs(list=>list.includes(id)?list:[...list,id]),[]);
  const unregister=useCallback(id=>setDialogs(list=>list.filter(item=>item!==id)),[]);
  const active=dialogs[dialogs.length-1];
  const context=useMemo(()=>({register,unregister,active,items}),[register,unregister,active,items]);
  return <ToastContext.Provider value={context}>
    {children}
    {!active&&items&&<div className="toast-stack">{items}</div>}
  </ToastContext.Provider>;
}

export function ModalToastOutlet() {
  const context=useContext(ToastContext),id=useRef(Symbol('dialog-toast')).current;
  const register=context?.register,unregister=context?.unregister;
  useEffect(()=>{if(!register)return;register(id);return ()=>unregister(id);},[register,unregister,id]);
  return context?.active===id&&context.items?<div className="toast-stack toast-stack-dialog">{context.items}</div>:null;
}
