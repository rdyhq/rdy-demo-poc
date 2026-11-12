// The picture is the address of a frame of the live stream at the provider. A page shows it through linb.io.
export type LiveState = {live:boolean; verified:boolean; viewers?:number; title?:string; picture?:string; clip?:{title:string;url:string;views?:number}};
