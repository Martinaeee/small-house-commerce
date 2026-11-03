import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
const url=process.env.DATABASE_URL;
if(!url)throw new Error('DATABASE_URL is required.');
const parsed=new URL(url),database=decodeURIComponent(parsed.pathname.slice(1));
if(!['localhost','127.0.0.1'].includes(parsed.hostname)||!/(^|[_-])(e2e|test)([_-]|$)/.test(database))throw new Error(`Refusing to seed non-disposable database "${database}".`);
const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const daysAgo=(days:number)=>new Date(Date.parse(`${today}T00:00:00Z`)-days*864e5).toISOString().slice(0,10);
async function main(){
 const owner=await prisma.user.findUniqueOrThrow({where:{email:'e2e-admin@smallhouse.test'}});
 const profile=await prisma.optimizerProfile.upsert({where:{userId:owner.id},update:{},create:{userId:owner.id,aid:'POST-DEMO-ADMIN',displayName:owner.name}});
 const products=await prisma.product.findMany({where:{status:'ACTIVE'},take:2,orderBy:{createdAt:'asc'}});
 if(products.length<2)throw new Error('Run seed-e2e first; two active products are required.');
 for(const [index,product] of products.entries())for(const [postIndex,days] of [0,1,4].entries()){
  const date=daysAgo(days),code=`postdemo${index}${postIndex}`;
  await prisma.campaignLink.upsert({where:{code},update:{},create:{code,ownerUserId:owner.id,aidSnapshot:profile.aid,productId:product.id,name:`${date.slice(5)}｜${product.name.slice(0,60)}｜示例帖子 ${postIndex+1}`,sourceType:'FB_POST',postDate:new Date(`${date}T00:00:00Z`),postUrl:postIndex===0?'https://www.facebook.com/':null,archivedAt:index===0&&postIndex===1?new Date():null}});
 }
 for(const [code,name,sourceType,product] of [['postdemolegacy','历史共用链接（发布日期未登记）','FB_POST',products[0]],['postdemoad','演示 Meta 广告链接','META_AD',products[1]]] as const){
  await prisma.campaignLink.upsert({where:{code},update:{},create:{code,name,sourceType,productId:product.id,ownerUserId:owner.id,aidSnapshot:profile.aid}});
 }
 console.log('Post-link demo seeded: 6 dated posts, 1 undated history, 1 Meta ad; local only.');
}
try{await main();}finally{await prisma.$disconnect();}
