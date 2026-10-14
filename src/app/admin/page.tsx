import type { Metadata } from "next";

import { AdminConsole } from "@/components/admin/admin-console";

export const metadata: Metadata = {
  title: "管理后台",
  robots: { index: false, follow: false },
};

/**
 * /admin：路由本身不设拦截，进来先是登录表单。
 * 所有真实能力（上传、上下架、删除、签发 signed URL）都在服务端二次校验身份，
 * 因此「隐藏入口」只是彩蛋，不是安全措施。
 */
export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-10">
      <AdminConsole />
    </main>
  );
}
