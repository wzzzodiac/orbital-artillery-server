// Cosmetic identifiers only. Shared by browser and server; never changes physics.
export const ANIMALS=Object.freeze([
 {id:'cuy',label:'Cuy'},{id:'fox',label:'Fox'},{id:'rabbit',label:'Rabbit'},
 {id:'capybara',label:'Capibara'},{id:'bear',label:'Bear'},{id:'cat',label:'Cat'}
].map(Object.freeze));
export const CARTS=Object.freeze([
 {id:'mototaxi',label:'Mototaxi'},{id:'tico',label:'Tico amarillo'},
 {id:'yaris',label:'Yaris'},{id:'pnp',label:'Patrullero PNP'},
 {id:'donofrio',label:"Helados D'Onofrio"},{id:'microbus',label:'Micro Lima'},
 {id:'triciclo',label:'Triciclo frutero'},{id:'rappi',label:'Moto Rappi'}
].map(Object.freeze));
export const LEGACY_CARTS=Object.freeze({kart:'mototaxi',buggy:'tico',tank:'yaris',rover:'pnp',wood:'donofrio',scrap:'microbus'});
export const DEFAULT_APPEARANCE=Object.freeze({animal:'cuy',cart:'mototaxi'});
export const validAnimal=value=>ANIMALS.some(item=>item.id===value);
export const canonicalCart=value=>typeof value==='string'?(Object.hasOwn(LEGACY_CARTS,value)?LEGACY_CARTS[value]:value):null;
export const validCart=value=>CARTS.some(item=>item.id===canonicalCart(value));
export function normalizeAppearance(value){
 return {animal:validAnimal(value?.animal)?value.animal:DEFAULT_APPEARANCE.animal,
  cart:validCart(value?.cart)?canonicalCart(value.cart):DEFAULT_APPEARANCE.cart};
}
