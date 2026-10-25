"use client";
import { useState } from "react";
const assetPathPrefix = "/figma";
const imgFrame = `${assetPathPrefix}/48ba7.svg`;
const imgFrame1 = `${assetPathPrefix}/d0126.svg`;
const imgGroup = `${assetPathPrefix}/19802.svg`;
const imgIconCheck = `${assetPathPrefix}/06171.svg`;
const imgIconAlert = `${assetPathPrefix}/00362.svg`;
const imgIconAlert1 = `${assetPathPrefix}/d6048.svg`;
const imgFrame2 = `${assetPathPrefix}/5742f.svg`;
const imgIconCheck1 = `${assetPathPrefix}/cd5e7.svg`;
const imgIconCheck2 = `${assetPathPrefix}/b88a4.svg`;
const imgGroup1 = `${assetPathPrefix}/682d5.svg`;

type SparoDealComparisonProps = {
  className?: string;
  state?: "Independent rental" | "Sparo cleared";
};

function SparoDealComparison({ className, state = "Sparo cleared" }: SparoDealComparisonProps) {
  const [selected, setSelected] = useState(state);
  const isIndependentRental = selected === "Independent rental";
  const isSparoCleared = selected === "Sparo cleared";
  return (
    <div className={className || "content-stretch flex flex-col gap-[28px] items-start relative w-[1248px]"} id={isSparoCleared ? "node-16_143" : "node-16_79"}>
      <div className="content-stretch flex gap-[20px] items-center relative shrink-0 w-[1248px]" id={isSparoCleared ? "node-16_144" : "node-16_80"} data-name="Scenario heading">
        <p className="[word-break:break-word] font-sans font-light leading-[57px] relative shrink-0 text-[38px] text-[color:var(--sparo-text,#f4f0eb)] w-[750px]" id={isSparoCleared ? "node-16_145" : "node-16_81"}>
          The whole deal adds up.
        </p>
        {isIndependentRental && (
          <>
            <div className="bg-[var(--sparo-accent,#e4a28b)] content-stretch flex h-[42px] items-center justify-center relative rounded-[999px] shrink-0 w-[204px]" data-node-id="16:82" data-name="Button / Independent rental">
              <p className="[word-break:break-word] font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-bg,#100f0e)] whitespace-nowrap" data-node-id="I16:82;8:67">
                Independent rental
              </p>
            </div>
            <button className="bg-[var(--sparo-bg,#100f0e)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch cursor-pointer flex h-[42px] items-center justify-center relative rounded-[999px] shrink-0 w-[172px]" onClick={() => setSelected("Sparo cleared")} data-node-id="16:84" data-name="Button / Sparo cleared">
              <p className="[word-break:break-word] font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] text-left whitespace-nowrap" data-node-id="I16:84;8:69">
                Sparo cleared
              </p>
            </button>
          </>
        )}
        {isSparoCleared && (
          <>
            <button className="bg-[var(--sparo-bg,#100f0e)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch cursor-pointer flex h-[42px] items-center justify-center relative rounded-[999px] shrink-0 w-[204px]" onClick={() => setSelected("Independent rental")} data-node-id="16:146" data-name="Button / Independent rental">
              <p className="[word-break:break-word] font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] text-left whitespace-nowrap" data-node-id="I16:146;8:69">
                Independent rental
              </p>
            </button>
            <div className="bg-[var(--sparo-accent,#e4a28b)] content-stretch flex h-[42px] items-center justify-center relative rounded-[999px] shrink-0 w-[172px]" data-node-id="16:148" data-name="Button / Sparo cleared">
              <p className="[word-break:break-word] font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-bg,#100f0e)] whitespace-nowrap" data-node-id="I16:148;8:67">
                Sparo cleared
              </p>
            </div>
          </>
        )}
      </div>
      <div className="content-stretch flex gap-[24px] items-start relative shrink-0 w-[1248px]" id={isSparoCleared ? "node-16_150" : "node-16_86"} data-name="Graph and economics">
        <div className="bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[16px] items-start p-[20px] relative rounded-[12px] shrink-0 w-[740px]" id={isSparoCleared ? "node-16_151" : "node-16_87"} data-name="Arrangement">
          {isIndependentRental && (
            <>
              <div className="bg-[var(--sparo-panel,#171615)] h-[310px] relative shrink-0 w-[700px]" data-node-id="16:88" data-name="Independent rental / deal graph">
                <div className="absolute h-[310px] left-0 top-0 w-[700px]" data-node-id="16:89" data-name="Frame">
                  <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame} />
                </div>
                <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[24px] p-[14px] rounded-[12px] top-[112px] w-[178px]" data-node-id="16:91" data-name="Acme AI">
                  <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="16:92">
                    Acme AI
                  </p>
                  <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="16:93">
                    Buyer · needs 6 A100s
                  </p>
                  <div className="bg-[var(--sparo-raised,#201d1b)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[93.7px]" data-node-id="16:94" data-name="Status / Independent">
                    <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] whitespace-nowrap" data-node-id="16:95">
                      Independent
                    </p>
                  </div>
                </div>
                <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[261px] p-[14px] rounded-[12px] top-[20px] w-[178px]" data-node-id="16:96" data-name="Atlas Compute">
                  <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="16:97">
                    Atlas Compute
                  </p>
                  <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="16:98">
                    Holder · 6 idle A100s
                  </p>
                  <div className="bg-[var(--sparo-raised,#201d1b)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[93.7px]" data-node-id="16:99" data-name="Status / Independent">
                    <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] whitespace-nowrap" data-node-id="16:100">
                      Independent
                    </p>
                  </div>
                </div>
                <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[498px] p-[14px] rounded-[12px] top-[112px] w-[178px]" data-node-id="16:101" data-name="Nova Cloud">
                  <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="16:102">
                    Nova Cloud
                  </p>
                  <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="16:103">
                    Provider · backfill
                  </p>
                  <div className="bg-[var(--sparo-raised,#201d1b)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[93.7px]" data-node-id="16:104" data-name="Status / Independent">
                    <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] whitespace-nowrap" data-node-id="16:105">
                      Independent
                    </p>
                  </div>
                </div>
                <p className="[word-break:break-word] absolute font-mono leading-[15px] left-[24px] not-italic text-[10px] text-[color:var(--sparo-subtle,#8e857d)] top-[284px] w-[652px]" data-node-id="16:106">
                  Separate purchases · no bundled backfill
                </p>
              </div>
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[700px]" data-node-id="16:107">
                Separate purchases leave reserved GPUs idle.
              </p>
            </>
          )}
          {isSparoCleared && (
            <>
              <div className="bg-[var(--sparo-panel,#171615)] h-[310px] relative shrink-0 w-[700px]" data-node-id="16:152" data-name="Cleared deal / graph">
                <div className="absolute h-[310px] left-0 top-0 w-[700px]" data-node-id="16:153" data-name="Frame">
                  <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame1} />
                </div>
                <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[24px] p-[14px] rounded-[12px] top-[112px] w-[178px]" data-node-id="16:155" data-name="Acme AI">
                  <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="16:156">
                    Acme AI
                  </p>
                  <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="16:157">
                    Buyer · needs 6 A100s
                  </p>
                  <div className="bg-[var(--sparo-accentBg,#35231e)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[64px]" data-node-id="16:158" data-name="Status / Demand">
                    <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] whitespace-nowrap" data-node-id="16:159">
                      Demand
                    </p>
                  </div>
                </div>
                <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[261px] p-[14px] rounded-[12px] top-[20px] w-[178px]" data-node-id="16:160" data-name="Atlas Compute">
                  <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="16:161">
                    Atlas Compute
                  </p>
                  <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="16:162">
                    Holder · 6 idle A100s
                  </p>
                  <div className="bg-[var(--sparo-accentBg,#35231e)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[87px]" data-node-id="16:163" data-name="Status / Authorized">
                    <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] whitespace-nowrap" data-node-id="16:164">
                      Authorized
                    </p>
                  </div>
                </div>
                <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[498px] p-[14px] rounded-[12px] top-[112px] w-[178px]" data-node-id="16:165" data-name="Nova Cloud">
                  <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="16:166">
                    Nova Cloud
                  </p>
                  <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="16:167">
                    Provider · backfill
                  </p>
                  <div className="bg-[var(--sparo-accentBg,#35231e)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[87px]" data-node-id="16:168" data-name="Status / Authorized">
                    <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] whitespace-nowrap" data-node-id="16:169">
                      Authorized
                    </p>
                  </div>
                </div>
                <p className="[word-break:break-word] absolute font-mono leading-[15px] left-[24px] not-italic text-[10px] text-[color:var(--sparo-accent,#e4a28b)] top-[284px] w-[652px]" data-node-id="16:170">
                  6 A100s / $2.10 per GPU-hr
                </p>
                <p className="[word-break:break-word] absolute font-mono leading-[14px] left-[208px] not-italic text-[9px] text-[color:var(--sparo-accent,#e4a28b)] top-[131px] w-[80px]" data-node-id="19:1038">
                  release ←
                </p>
                <p className="[word-break:break-word] absolute font-mono leading-[14px] left-[400px] not-italic text-[9px] text-[color:var(--sparo-accent,#e4a28b)] top-[131px] w-[90px]" data-node-id="19:1039">
                  ← backfill
                </p>
                <p className="[word-break:break-word] absolute font-mono leading-[14px] left-[220px] not-italic text-[9px] text-[color:var(--sparo-subtle,#8e857d)] top-[248px] w-[260px]" data-node-id="19:1040">
                  Payment after verification
                </p>
              </div>
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[700px]" data-node-id="16:171">
                Compute and authorized backfill are bundled.
              </p>
            </>
          )}
        </div>
        <div className="bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[16px] items-start p-[24px] relative rounded-[12px] shrink-0 w-[484px]" id={isSparoCleared ? "node-16_172" : "node-16_108"} data-name="Economics">
          <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" id={isSparoCleared ? "node-16_173" : "node-16_109"}>
            DEAL_7F3A21 · 6 A100S · 10H
          </p>
          <p className="[word-break:break-word] font-sans font-normal leading-[36px] relative shrink-0 text-[24px] text-[color:var(--sparo-text,#f4f0eb)] w-[436px]" id={isSparoCleared ? "node-16_174" : "node-16_110"}>
            {isSparoCleared ? "Sparo cleared" : "Independent rental"}
          </p>
          <div className="content-stretch flex flex-col items-start relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_175" : "node-16_111"} data-name="Scenario economics">
            <div className="bg-[var(--sparo-raised,#201d1b)] content-stretch flex items-center py-[13px] relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_176" : "node-16_112"} data-name="Table header">
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[230px]" id={isSparoCleared ? "node-16_177" : "node-16_113"} data-name="Per hour">
                <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[208px]" id={isSparoCleared ? "node-16_178" : "node-16_114"}>
                  PER HOUR
                </p>
              </div>
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[206px]" id={isSparoCleared ? "node-16_179" : "node-16_115"} data-name="This arrangement">
                <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[184px]" id={isSparoCleared ? "node-16_180" : "node-16_116"}>
                  THIS ARRANGEMENT
                </p>
              </div>
            </div>
            <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_181" : "node-16_117"} data-name="Row / Acme cost">
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[230px]" id={isSparoCleared ? "node-16_182" : "node-16_118"} data-name="Cell">
                <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[205px]" id={isSparoCleared ? "node-16_183" : "node-16_119"}>
                  Acme cost
                </p>
              </div>
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[206px]" id={isSparoCleared ? "node-16_184" : "node-16_120"} data-name="Cell">
                <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[181px]" id={isSparoCleared ? "node-16_185" : "node-16_121"}>
                  {isSparoCleared ? "$12.60" : "$21.00"}
                </p>
              </div>
            </div>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_186" : "node-16_122"} data-name="Divider" />
            <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_187" : "node-16_123"} data-name="Row / Atlas capacity">
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[230px]" id={isSparoCleared ? "node-16_188" : "node-16_124"} data-name="Cell">
                <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[205px]" id={isSparoCleared ? "node-16_189" : "node-16_125"}>
                  Atlas capacity
                </p>
              </div>
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[206px]" id={isSparoCleared ? "node-16_190" : "node-16_126"} data-name="Cell">
                <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[181px]" id={isSparoCleared ? "node-16_191" : "node-16_127"}>
                  {isSparoCleared ? "6 earning" : "6 idle, paid for"}
                </p>
              </div>
            </div>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_192" : "node-16_128"} data-name="Divider" />
            <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_193" : "node-16_129"} data-name="Row / Nova capacity">
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[230px]" id={isSparoCleared ? "node-16_194" : "node-16_130"} data-name="Cell">
                <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[205px]" id={isSparoCleared ? "node-16_195" : "node-16_131"}>
                  Nova capacity
                </p>
              </div>
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[206px]" id={isSparoCleared ? "node-16_196" : "node-16_132"} data-name="Cell">
                <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[181px]" id={isSparoCleared ? "node-16_197" : "node-16_133"}>
                  {isSparoCleared ? "Sold" : "Unsold"}
                </p>
              </div>
            </div>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_198" : "node-16_134"} data-name="Divider" />
            <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_199" : "node-16_135"} data-name="Row / Net saving">
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[230px]" id={isSparoCleared ? "node-16_200" : "node-16_136"} data-name="Cell">
                <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[205px]" id={isSparoCleared ? "node-16_201" : "node-16_137"}>
                  Net saving
                </p>
              </div>
              <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[206px]" id={isSparoCleared ? "node-16_202" : "node-16_138"} data-name="Cell">
                <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[181px]" id={isSparoCleared ? "node-16_203" : "node-16_139"}>
                  {isSparoCleared ? "$8.40" : "$0.00"}
                </p>
              </div>
            </div>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[436px]" id={isSparoCleared ? "node-16_204" : "node-16_140"} data-name="Divider" />
          </div>
          {isIndependentRental && (
            <div className="bg-[var(--sparo-raised,#201d1b)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[140.6px]" data-node-id="16:141" data-name="Status / Baseline reference">
              <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] whitespace-nowrap" data-node-id="16:142">
                Baseline reference
              </p>
            </div>
          )}
          {isSparoCleared && (
            <div className="bg-[var(--sparo-greenBg,#1c2d24)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[140.6px]" data-node-id="16:205" data-name="Status / 40% below baseline">
              <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-green,#a5ccb4)] whitespace-nowrap" data-node-id="16:206">
                40% below baseline
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Welcome() {
  const navigate = (target: EventTarget) => { const node = (target as HTMLElement).closest<HTMLElement>("[data-nav]"); if (node?.dataset.nav) window.location.assign(node.dataset.nav); };
  return (
    <div onClick={e => navigate(e.target)} onKeyDown={e => { if(e.key === "Enter") navigate(e.target); }} className="landing figma-landing bg-[var(--sparo-bg,#100f0e)] content-stretch flex flex-col items-start relative" data-node-id="8:75" data-name="01 / Website / Desktop">
      <div className="bg-[var(--sparo-bg,#100f0e)] h-[880px] overflow-clip relative shrink-0 w-[1440px]" data-node-id="10:2" data-name="Hero / Idle capacity finds opportunity">
        <div className="absolute h-[880px] left-0 overflow-clip top-0 w-[1440px]" data-node-id="10:3" data-name="Copper light / editable artwork">
          <div className="absolute blur-[4px] h-[11px] left-[640px] top-0 w-[840px]" data-node-id="10:4" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.14) 35%, rgba(241, 171, 153, 0.21) 52%, rgba(139, 61, 50, 0.14) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 0" />
          <div className="absolute blur-[1.5px] h-[4px] left-[668.07px] top-[13.75px] w-[840px]" data-node-id="10:5" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.409) 35%, rgba(241, 171, 153, 0.614) 52%, rgba(139, 61, 50, 0.409) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 1" />
          <div className="absolute blur-[1.5px] h-[4px] left-[693.64px] top-[27.5px] w-[840px]" data-node-id="10:6" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.182) 35%, rgba(241, 171, 153, 0.273) 52%, rgba(139, 61, 50, 0.182) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 2" />
          <div className="absolute blur-[1.5px] h-[4px] left-[714.42px] top-[41.25px] w-[840px]" data-node-id="10:7" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.331) 35%, rgba(241, 171, 153, 0.497) 52%, rgba(139, 61, 50, 0.331) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 3" />
          <div className="absolute blur-[4px] h-[11px] left-[728.54px] top-[55px] w-[840px]" data-node-id="10:8" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.283) 35%, rgba(241, 171, 153, 0.425) 52%, rgba(139, 61, 50, 0.283) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 4" />
          <div className="absolute blur-[1.5px] h-[4px] left-[734.76px] top-[68.75px] w-[840px]" data-node-id="10:9" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.223) 35%, rgba(241, 171, 153, 0.334) 52%, rgba(139, 61, 50, 0.223) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 5" />
          <div className="absolute blur-[1.5px] h-[4px] left-[732.52px] top-[82.5px] w-[840px]" data-node-id="10:10" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.382) 35%, rgba(241, 171, 153, 0.573) 52%, rgba(139, 61, 50, 0.382) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 6" />
          <div className="absolute blur-[1.5px] h-[4px] left-[722px] top-[96.25px] w-[840px]" data-node-id="10:11" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.149) 35%, rgba(241, 171, 153, 0.223) 52%, rgba(139, 61, 50, 0.149) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 7" />
          <div className="absolute blur-[4px] h-[11px] left-[704.17px] top-[110px] w-[840px]" data-node-id="10:12" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.42) 35%, rgba(241, 171, 153, 0.63) 52%, rgba(139, 61, 50, 0.42) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 8" />
          <div className="absolute blur-[1.5px] h-[4px] left-[680.6px] top-[123.75px] w-[840px]" data-node-id="10:13" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.154) 35%, rgba(241, 171, 153, 0.23) 52%, rgba(139, 61, 50, 0.154) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 9" />
          <div className="absolute blur-[1.5px] h-[4px] left-[653.41px] top-[137.5px] w-[840px]" data-node-id="10:14" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.373) 35%, rgba(241, 171, 153, 0.56) 52%, rgba(139, 61, 50, 0.373) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 10" />
          <div className="absolute blur-[1.5px] h-[4px] left-[625.01px] top-[151.25px] w-[840px]" data-node-id="10:15" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.235) 35%, rgba(241, 171, 153, 0.352) 52%, rgba(139, 61, 50, 0.235) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 11" />
          <div className="absolute blur-[4px] h-[11px] left-[597.96px] top-[165px] w-[840px]" data-node-id="10:16" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.27) 35%, rgba(241, 171, 153, 0.406) 52%, rgba(139, 61, 50, 0.27) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 12" />
          <div className="absolute blur-[1.5px] h-[4px] left-[574.66px] top-[178.75px] w-[840px]" data-node-id="10:17" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.343) 35%, rgba(241, 171, 153, 0.515) 52%, rgba(139, 61, 50, 0.343) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 13" />
          <div className="absolute blur-[1.5px] h-[4px] left-[557.2px] top-[192.5px] w-[840px]" data-node-id="10:18" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.173) 35%, rgba(241, 171, 153, 0.26) 52%, rgba(139, 61, 50, 0.173) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 14" />
          <div className="absolute blur-[1.5px] h-[4px] left-[547.13px] top-[206.25px] w-[840px]" data-node-id="10:19" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.413) 35%, rgba(241, 171, 153, 0.62) 52%, rgba(139, 61, 50, 0.413) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 15" />
          <div className="absolute blur-[4px] h-[11px] left-[545.36px] top-[220px] w-[840px]" data-node-id="10:20" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.141) 35%, rgba(241, 171, 153, 0.211) 52%, rgba(139, 61, 50, 0.141) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 16" />
          <div className="absolute blur-[1.5px] h-[4px] left-[552.05px] top-[233.75px] w-[840px]" data-node-id="10:21" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.404) 35%, rgba(241, 171, 153, 0.605) 52%, rgba(139, 61, 50, 0.404) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 17" />
          <div className="absolute blur-[1.5px] h-[4px] left-[566.59px] top-[247.5px] w-[840px]" data-node-id="10:22" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.192) 35%, rgba(241, 171, 153, 0.288) 52%, rgba(139, 61, 50, 0.192) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 18" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-594px] top-[261.25px] w-[900px]" data-node-id="10:23" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.319) 35%, rgba(241, 171, 153, 0.479) 52%, rgba(139, 61, 50, 0.319) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 19" />
          <div className="absolute blur-[4px] h-[11px] left-[-578px] top-[275px] w-[900px]" data-node-id="10:24" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.296) 35%, rgba(241, 171, 153, 0.444) 52%, rgba(139, 61, 50, 0.296) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 20" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-562px] top-[288.75px] w-[900px]" data-node-id="10:25" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.211) 35%, rgba(241, 171, 153, 0.317) 52%, rgba(139, 61, 50, 0.211) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 21" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-546px] top-[302.5px] w-[900px]" data-node-id="10:26" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.391) 35%, rgba(241, 171, 153, 0.586) 52%, rgba(139, 61, 50, 0.391) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 22" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-530px] top-[316.25px] w-[900px]" data-node-id="10:27" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.145) 35%, rgba(241, 171, 153, 0.217) 52%, rgba(139, 61, 50, 0.145) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 23" />
          <div className="absolute blur-[4px] h-[11px] left-[-514px] top-[330px] w-[900px]" data-node-id="10:28" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.419) 35%, rgba(241, 171, 153, 0.628) 52%, rgba(139, 61, 50, 0.419) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 24" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-498px] top-[343.75px] w-[900px]" data-node-id="10:29" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.16) 35%, rgba(241, 171, 153, 0.239) 52%, rgba(139, 61, 50, 0.16) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 25" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-482px] top-[357.5px] w-[900px]" data-node-id="10:30" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.363) 35%, rgba(241, 171, 153, 0.545) 52%, rgba(139, 61, 50, 0.363) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 26" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-466px] top-[371.25px] w-[900px]" data-node-id="10:31" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.247) 35%, rgba(241, 171, 153, 0.37) 52%, rgba(139, 61, 50, 0.247) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 27" />
          <div className="absolute blur-[4px] h-[11px] left-[-450px] top-[385px] w-[900px]" data-node-id="10:32" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.258) 35%, rgba(241, 171, 153, 0.387) 52%, rgba(139, 61, 50, 0.258) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 28" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-434px] top-[398.75px] w-[900px]" data-node-id="10:33" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.354) 35%, rgba(241, 171, 153, 0.531) 52%, rgba(139, 61, 50, 0.354) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 29" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-418px] top-[412.5px] w-[900px]" data-node-id="10:34" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.166) 35%, rgba(241, 171, 153, 0.248) 52%, rgba(139, 61, 50, 0.166) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 30" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-402px] top-[426.25px] w-[900px]" data-node-id="10:35" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.417) 35%, rgba(241, 171, 153, 0.625) 52%, rgba(139, 61, 50, 0.417) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 31" />
          <div className="absolute blur-[4px] h-[11px] left-[-386px] top-[440px] w-[900px]" data-node-id="10:36" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.142) 35%, rgba(241, 171, 153, 0.213) 52%, rgba(139, 61, 50, 0.142) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 32" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-370px] top-[453.75px] w-[900px]" data-node-id="10:37" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.397) 35%, rgba(241, 171, 153, 0.596) 52%, rgba(139, 61, 50, 0.397) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 33" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-354px] top-[467.5px] w-[900px]" data-node-id="10:38" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.202) 35%, rgba(241, 171, 153, 0.303) 52%, rgba(139, 61, 50, 0.202) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 34" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-338px] top-[481.25px] w-[900px]" data-node-id="10:39" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.307) 35%, rgba(241, 171, 153, 0.46) 52%, rgba(139, 61, 50, 0.307) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 35" />
          <div className="absolute blur-[4px] h-[11px] left-[-322px] top-[495px] w-[900px]" data-node-id="10:40" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.309) 35%, rgba(241, 171, 153, 0.463) 52%, rgba(139, 61, 50, 0.309) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 36" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-306px] top-[508.75px] w-[900px]" data-node-id="10:41" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.2) 35%, rgba(241, 171, 153, 0.301) 52%, rgba(139, 61, 50, 0.2) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 37" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-290px] top-[522.5px] w-[900px]" data-node-id="10:42" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.398) 35%, rgba(241, 171, 153, 0.597) 52%, rgba(139, 61, 50, 0.398) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 38" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-274px] top-[536.25px] w-[900px]" data-node-id="10:43" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.142) 35%, rgba(241, 171, 153, 0.213) 52%, rgba(139, 61, 50, 0.142) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 39" />
          <div className="absolute blur-[4px] h-[11px] left-[-258px] top-[550px] w-[900px]" data-node-id="10:44" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.416) 35%, rgba(241, 171, 153, 0.625) 52%, rgba(139, 61, 50, 0.416) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 40" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-242px] top-[563.75px] w-[900px]" data-node-id="10:45" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.167) 35%, rgba(241, 171, 153, 0.25) 52%, rgba(139, 61, 50, 0.167) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 41" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-226px] top-[577.5px] w-[900px]" data-node-id="10:46" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.353) 35%, rgba(241, 171, 153, 0.529) 52%, rgba(139, 61, 50, 0.353) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 42" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-210px] top-[591.25px] w-[900px]" data-node-id="10:47" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.259) 35%, rgba(241, 171, 153, 0.389) 52%, rgba(139, 61, 50, 0.259) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 43" />
          <div className="absolute blur-[4px] h-[11px] left-[-194px] top-[605px] w-[900px]" data-node-id="10:48" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.245) 35%, rgba(241, 171, 153, 0.368) 52%, rgba(139, 61, 50, 0.245) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 44" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-178px] top-[618.75px] w-[900px]" data-node-id="10:49" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.365) 35%, rgba(241, 171, 153, 0.547) 52%, rgba(139, 61, 50, 0.365) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 45" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-162px] top-[632.5px] w-[900px]" data-node-id="10:50" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.159) 35%, rgba(241, 171, 153, 0.238) 52%, rgba(139, 61, 50, 0.159) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 46" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-146px] top-[646.25px] w-[900px]" data-node-id="10:51" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.419) 35%, rgba(241, 171, 153, 0.628) 52%, rgba(139, 61, 50, 0.419) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 47" />
          <div className="absolute blur-[4px] h-[11px] left-[-130px] top-[660px] w-[900px]" data-node-id="10:52" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.145) 35%, rgba(241, 171, 153, 0.218) 52%, rgba(139, 61, 50, 0.145) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 48" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-114px] top-[673.75px] w-[900px]" data-node-id="10:53" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.39) 35%, rgba(241, 171, 153, 0.584) 52%, rgba(139, 61, 50, 0.39) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 49" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-98px] top-[687.5px] w-[900px]" data-node-id="10:54" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.213) 35%, rgba(241, 171, 153, 0.319) 52%, rgba(139, 61, 50, 0.213) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 50" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-82px] top-[701.25px] w-[900px]" data-node-id="10:55" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.294) 35%, rgba(241, 171, 153, 0.441) 52%, rgba(139, 61, 50, 0.294) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 51" />
          <div className="absolute blur-[4px] h-[11px] left-[-66px] top-[715px] w-[900px]" data-node-id="10:56" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.321) 35%, rgba(241, 171, 153, 0.481) 52%, rgba(139, 61, 50, 0.321) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 52" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-50px] top-[728.75px] w-[900px]" data-node-id="10:57" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.19) 35%, rgba(241, 171, 153, 0.285) 52%, rgba(139, 61, 50, 0.19) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 53" />
          <div className="absolute blur-[1.5px] h-[4px] left-[-34px] top-[742.5px] w-[900px]" data-node-id="10:58" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.404) 35%, rgba(241, 171, 153, 0.607) 52%, rgba(139, 61, 50, 0.404) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 54" />
          <div className="absolute blur-[1.5px] h-[4px] left-[572.38px] top-[756.25px] w-[840px]" data-node-id="10:59" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.14) 35%, rgba(241, 171, 153, 0.211) 52%, rgba(139, 61, 50, 0.14) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 55" />
          <div className="absolute blur-[4px] h-[11px] left-[555.68px] top-[770px] w-[840px]" data-node-id="10:60" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.413) 35%, rgba(241, 171, 153, 0.619) 52%, rgba(139, 61, 50, 0.413) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 56" />
          <div className="absolute blur-[1.5px] h-[4px] left-[546.51px] top-[783.75px] w-[840px]" data-node-id="10:61" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.175) 35%, rgba(241, 171, 153, 0.262) 52%, rgba(139, 61, 50, 0.175) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 57" />
          <div className="absolute blur-[1.5px] h-[4px] left-[545.7px] top-[797.5px] w-[840px]" data-node-id="10:62" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.341) 35%, rgba(241, 171, 153, 0.512) 52%, rgba(139, 61, 50, 0.341) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 58" />
          <div className="absolute blur-[1.5px] h-[4px] left-[553.3px] top-[811.25px] w-[840px]" data-node-id="10:63" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.272) 35%, rgba(241, 171, 153, 0.408) 52%, rgba(139, 61, 50, 0.272) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 59" />
          <div className="absolute blur-[4px] h-[11px] left-[568.66px] top-[825px] w-[840px]" data-node-id="10:64" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.233) 35%, rgba(241, 171, 153, 0.349) 52%, rgba(139, 61, 50, 0.233) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 60" />
          <div className="absolute blur-[1.5px] h-[4px] left-[590.38px] top-[838.75px] w-[840px]" data-node-id="10:65" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.374) 35%, rgba(241, 171, 153, 0.562) 52%, rgba(139, 61, 50, 0.374) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 61" />
          <div className="absolute blur-[1.5px] h-[4px] left-[616.54px] top-[852.5px] w-[840px]" data-node-id="10:66" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.153) 35%, rgba(241, 171, 153, 0.229) 52%, rgba(139, 61, 50, 0.153) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 62" />
          <div className="absolute blur-[1.5px] h-[4px] left-[644.79px] top-[866.25px] w-[840px]" data-node-id="10:67" style={{ backgroundImage: "linear-gradient(90deg, rgba(63, 25, 21, 0) 0%, rgba(153, 72, 61, 0.42) 35%, rgba(241, 171, 153, 0.63) 52%, rgba(139, 61, 50, 0.42) 70%, rgba(49, 23, 18, 0) 100%)" }} data-name="Light band 63" />
        </div>
        <div className="absolute content-stretch flex items-center justify-between left-[92px] top-[28px] w-[1256px]" data-node-id="10:68" data-name="Navigation">
          <div className="content-stretch flex gap-[10px] items-center relative shrink-0 w-[265px]" data-node-id="10:69" data-name="Sparo wordmark">
            <div className="overflow-clip relative shrink-0 size-[30px]" data-node-id="10:70" data-name="Sparo / Stacked S">
              <div className="absolute inset-[6.25%_1.25%_8.75%_0]" data-node-id="10:71" data-name="Group">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgGroup} />
              </div>
            </div>
            <p className="[word-break:break-word] font-sans font-medium leading-[39px] relative shrink-0 text-[26px] text-[color:var(--sparo-text,#f4f0eb)] tracking-[1.4px] whitespace-nowrap" data-node-id="10:79">
              sparo
            </p>
          </div>
          <button className="[word-break:break-word] block cursor-pointer font-sans font-normal leading-[0] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] text-left whitespace-nowrap" data-nav="#node-10-160" role="link" tabIndex={0} data-node-id="10:80">
            <p className="leading-[20px]">How it works</p>
          </button>
          <button className="[word-break:break-word] block cursor-pointer font-sans font-normal leading-[0] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] text-left whitespace-nowrap" data-nav="/market" role="link" tabIndex={0} data-node-id="10:81">
            <p className="leading-[20px]">Market</p>
          </button>
          <button className="[word-break:break-word] block cursor-pointer font-sans font-normal leading-[0] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] text-left whitespace-nowrap" data-nav="#node-10-441" role="link" tabIndex={0} data-node-id="10:82">
            <p className="leading-[20px]">Controls</p>
          </button>
          <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] whitespace-nowrap" data-nav="https://github.com/DheekshaBaskaran/SpareChange#readme" role="link" tabIndex={0} data-node-id="10:83">
            Docs
          </p>
          <a className="bg-[var(--sparo-bg,#100f0e)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch cursor-pointer flex h-[42px] items-center justify-center relative rounded-[999px] shrink-0 w-[220px]" data-nav="/" role="link" tabIndex={0} data-node-id="10:84" data-name="Button / View demo dashboard → overview">
            <p className="[word-break:break-word] font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] text-left whitespace-nowrap" data-node-id="I10:84;8:69">
              View demo dashboard
            </p>
          </a>
        </div>
        <div className="absolute content-stretch flex flex-col gap-[24px] items-center left-[320px] top-[246px] w-[800px]" data-node-id="10:86" data-name="Hero content">
          <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] text-center tracking-[1.3px] w-[800px]" data-node-id="10:87">
            A MORE EFFICIENT COMPUTE MARKET
          </p>
          <div className="[word-break:break-word] font-sans font-light leading-[0] relative shrink-0 text-[64px] text-[color:var(--sparo-text,#f4f0eb)] text-center tracking-[-2px] w-[800px]" data-node-id="10:88">
            <p className="leading-[72px] mb-0">Idle capacity</p>
            <p className="leading-[72px]">finds opportunity.</p>
          </div>
          <div className="[word-break:break-word] font-sans font-normal leading-[0] relative shrink-0 text-[18px] text-[color:var(--sparo-muted,#b6ada5)] text-center w-[760px]" data-node-id="10:89">
            <p className="leading-[27px] mb-0">Sparo brings idle compute, urgent demand, and replacement</p>
            <p className="leading-[27px]">capacity into one deal — settled only after work is verified.</p>
          </div>
          <div className="content-stretch flex gap-[16px] items-center justify-center relative shrink-0 w-[520px]" data-node-id="10:90" data-name="Hero actions">
            <div className="bg-[var(--sparo-accent,#e4a28b)] content-stretch flex h-[42px] items-center justify-center relative rounded-[999px] shrink-0 w-[284px]" data-nav="/" role="link" tabIndex={0} data-node-id="10:91" data-name="Button / Open the demo dashboard  → → overview">
              <p className="[word-break:break-word] font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-bg,#100f0e)] whitespace-pre" data-node-id="I10:91;8:67">{`Open the demo dashboard  →`}</p>
            </div>
            <button className="bg-[var(--sparo-bg,#100f0e)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch cursor-pointer flex h-[42px] items-center justify-center relative rounded-[999px] shrink-0 w-[220px]" data-nav="/deals" role="link" tabIndex={0} data-node-id="10:93" data-name="Button / See a deal in action → deal">
              <p className="[word-break:break-word] font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] text-left whitespace-nowrap" data-node-id="I10:93;8:69">
                See a deal in action
              </p>
            </button>
          </div>
          <p className="[word-break:break-word] font-mono leading-[1.5] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] text-center w-[800px]" data-node-id="10:95">
            No sign-in. Seeded demo data. Testnet settlement.
          </p>
        </div>
        <div className="[word-break:break-word] absolute font-mono leading-[0] left-[92px] not-italic text-[11px] text-[color:var(--sparo-muted,#b6ada5)] top-[772px] w-[280px]" data-node-id="10:96">
          <p className="leading-[1.5] mb-0">REAL DEMAND.</p>
          <p className="leading-[1.5] mb-0">REAL CAPACITY.</p>
          <p className="leading-[1.5]">A MORE OPEN MARKET.</p>
        </div>
        <p className="[word-break:break-word] absolute font-mono leading-[15px] left-[1140px] not-italic text-[10px] text-[color:var(--sparo-muted,#b6ada5)] top-[810px] w-[210px] whitespace-pre-wrap" data-node-id="10:97">{`SCROLL TO EXPLORE  ↓`}</p>
        <div className="absolute bg-[var(--sparo-line,#34302d)] h-px left-[92px] top-[850px] w-[1256px]" data-node-id="10:98" data-name="Divider" />
      </div>
      <div className="bg-[var(--sparo-panel,#171615)] content-stretch flex flex-col gap-[36px] items-start p-[96px] relative shrink-0 w-[1440px]" data-node-id="10:99" data-name="01 / Proof at a glance">
        <div className="[word-break:break-word] content-stretch flex gap-[40px] items-center relative shrink-0 w-[1247px]" data-node-id="10:100" data-name="Deal impact">
          <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-[389px]" data-node-id="10:101" data-name="lower buyer rate">
            <p className="font-sans font-light leading-[72px] relative shrink-0 text-[48px] text-[color:var(--sparo-text,#f4f0eb)] w-[389px]" data-node-id="10:102">
              40%
            </p>
            <p className="font-sans font-normal leading-[24px] relative shrink-0 text-[16px] text-[color:var(--sparo-text,#f4f0eb)] w-[389px]" data-node-id="10:103">
              lower buyer rate
            </p>
            <p className="font-mono leading-[18px] not-italic relative shrink-0 text-[12px] text-[color:var(--sparo-subtle,#8e857d)] w-[389px]" data-node-id="10:104">
              $2.10 vs $3.50 / GPU-hr
            </p>
          </div>
          <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-[389px]" data-node-id="10:105" data-name="saved each hour">
            <p className="font-sans font-light leading-[72px] relative shrink-0 text-[48px] text-[color:var(--sparo-text,#f4f0eb)] w-[389px]" data-node-id="10:106">
              $8.40
            </p>
            <p className="font-sans font-normal leading-[24px] relative shrink-0 text-[16px] text-[color:var(--sparo-text,#f4f0eb)] w-[389px]" data-node-id="10:107">
              saved each hour
            </p>
            <p className="font-mono leading-[18px] not-italic relative shrink-0 text-[12px] text-[color:var(--sparo-subtle,#8e857d)] w-[389px]" data-node-id="10:108">
              6 A100s · demo fixture
            </p>
          </div>
          <div className="content-stretch flex flex-col gap-[8px] items-start relative shrink-0 w-[389px]" data-node-id="10:109" data-name="earned by the holder">
            <p className="font-sans font-light leading-[72px] relative shrink-0 text-[48px] text-[color:var(--sparo-text,#f4f0eb)] w-[389px]" data-node-id="10:110">
              $4.08
            </p>
            <p className="font-sans font-normal leading-[24px] relative shrink-0 text-[16px] text-[color:var(--sparo-text,#f4f0eb)] w-[389px]" data-node-id="10:111">
              earned by the holder
            </p>
            <p className="font-mono leading-[18px] not-italic relative shrink-0 text-[12px] text-[color:var(--sparo-subtle,#8e857d)] w-[389px]" data-node-id="10:112">
              per hour on reserved capacity
            </p>
          </div>
        </div>
        <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:113" data-name="Divider" />
        <div className="content-stretch flex gap-[24px] items-center relative shrink-0 w-[1248px]" data-node-id="10:114" data-name="Four guarantees">
          <div className="content-stretch flex flex-col gap-[10px] items-start relative shrink-0 w-[294px]" data-node-id="10:115" data-name="Deterministic clearing">
            <div className="relative shrink-0 size-[20px]" data-node-id="10:116" data-name="Icon / check">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck} />
            </div>
            <p className="[word-break:break-word] font-sans font-medium leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-text,#f4f0eb)] w-[294px]" data-node-id="10:118">
              Deterministic clearing
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[18px] relative shrink-0 text-[12px] text-[color:var(--sparo-muted,#b6ada5)] w-[294px]" data-node-id="10:119">
              Same inputs. Same feasibility decision.
            </p>
          </div>
          <div className="content-stretch flex flex-col gap-[10px] items-start relative shrink-0 w-[294px]" data-node-id="10:120" data-name="Balanced ledger">
            <div className="relative shrink-0 size-[20px]" data-node-id="10:121" data-name="Icon / check">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck} />
            </div>
            <p className="[word-break:break-word] font-sans font-medium leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-text,#f4f0eb)] w-[294px]" data-node-id="10:123">
              Balanced ledger
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[18px] relative shrink-0 text-[12px] text-[color:var(--sparo-muted,#b6ada5)] w-[294px]" data-node-id="10:124">
              Every posting has an equal counter-entry.
            </p>
          </div>
          <div className="content-stretch flex flex-col gap-[10px] items-start relative shrink-0 w-[294px]" data-node-id="10:125" data-name="Versioned approval">
            <div className="relative shrink-0 size-[20px]" data-node-id="10:126" data-name="Icon / check">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck} />
            </div>
            <p className="[word-break:break-word] font-sans font-medium leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-text,#f4f0eb)] w-[294px]" data-node-id="10:128">
              Versioned approval
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[18px] relative shrink-0 text-[12px] text-[color:var(--sparo-muted,#b6ada5)] w-[294px]" data-node-id="10:129">
              Everyone signs the same terms version.
            </p>
          </div>
          <div className="content-stretch flex flex-col gap-[10px] items-start relative shrink-0 w-[294px]" data-node-id="10:130" data-name="Verification first">
            <div className="relative shrink-0 size-[20px]" data-node-id="10:131" data-name="Icon / check">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck} />
            </div>
            <p className="[word-break:break-word] font-sans font-medium leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-text,#f4f0eb)] w-[294px]" data-node-id="10:133">
              Verification first
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[18px] relative shrink-0 text-[12px] text-[color:var(--sparo-muted,#b6ada5)] w-[294px]" data-node-id="10:134">
              No verification, no payment.
            </p>
          </div>
        </div>
      </div>
      <div className="bg-[var(--sparo-bg,#100f0e)] content-stretch flex flex-col gap-[32px] items-start p-[96px] relative shrink-0 w-[1440px]" data-node-id="10:135" data-name="02 / The coordination problem">
        <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:136">
          THE OPPORTUNITY HIDING IN PLAIN SIGHT
        </p>
        <div className="[word-break:break-word] font-sans font-light leading-[0] relative shrink-0 text-[46px] text-[color:var(--sparo-text,#f4f0eb)] w-[1000px]" data-node-id="10:137">
          <p className="leading-[69px] mb-0">The capacity exists.</p>
          <p className="leading-[69px]">The arrangement is missing.</p>
        </div>
        <div className="content-stretch flex gap-[32px] items-center relative shrink-0 w-[1246px]" data-node-id="10:138" data-name="Three sides of the problem">
          <div className="content-stretch flex flex-col gap-[18px] items-start relative shrink-0 w-[394px]" data-node-id="10:139" data-name="Reserved. Paid for. Idle.">
            <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:140">
              01
            </p>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[394px]" data-node-id="10:141" data-name="Divider" />
            <p className="[word-break:break-word] font-sans font-normal leading-[35px] relative shrink-0 text-[23px] text-[color:var(--sparo-text,#f4f0eb)] w-[394px]" data-node-id="10:142">
              Reserved. Paid for. Idle.
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-muted,#b6ada5)] w-[394px]" data-node-id="10:143">
              Atlas has eight reserved GPUs and uses two. The other six keep costing money.
            </p>
          </div>
          <div className="content-stretch flex flex-col gap-[18px] items-start relative shrink-0 w-[394px]" data-node-id="10:144" data-name="A deadline cannot wait.">
            <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:145">
              02
            </p>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[394px]" data-node-id="10:146" data-name="Divider" />
            <p className="[word-break:break-word] font-sans font-normal leading-[35px] relative shrink-0 text-[23px] text-[color:var(--sparo-text,#f4f0eb)] w-[394px]" data-node-id="10:147">
              A deadline cannot wait.
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-muted,#b6ada5)] w-[394px]" data-node-id="10:148">
              Acme needs six A100s now. Independent market access can take three days.
            </p>
          </div>
          <div className="content-stretch flex flex-col gap-[18px] items-start relative shrink-0 w-[394px]" data-node-id="10:149" data-name="Nobody moves first.">
            <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:150">
              03
            </p>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[394px]" data-node-id="10:151" data-name="Divider" />
            <p className="[word-break:break-word] font-sans font-normal leading-[35px] relative shrink-0 text-[23px] text-[color:var(--sparo-text,#f4f0eb)] w-[394px]" data-node-id="10:152">
              Nobody moves first.
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-muted,#b6ada5)] w-[394px]" data-node-id="10:153">
              A holder needs authorized backfill before releasing capacity. Every leg depends on the next.
            </p>
          </div>
        </div>
        <div className="bg-[var(--sparo-accentBg,#35231e)] content-stretch flex gap-[12px] items-start p-[16px] relative rounded-[8px] shrink-0 w-[1248px]" data-node-id="10:154" data-name="A better bundle, or no deal.">
          <div className="relative shrink-0 size-[18px]" data-node-id="10:155" data-name="Icon / alert">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconAlert} />
          </div>
          <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start relative shrink-0 w-[1186px]" data-node-id="10:157" data-name="Message">
            <p className="font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-accent,#e4a28b)] w-[1186px]" data-node-id="10:158">
              A better bundle, or no deal.
            </p>
            <p className="font-sans font-normal leading-[18px] relative shrink-0 text-[12px] text-[color:var(--sparo-muted,#b6ada5)] w-[1186px]" data-node-id="10:159">
              Sparo only proposes an arrangement that beats the best independent baseline, including switching cost and coordination fees.
            </p>
          </div>
        </div>
      </div>
      <div className="bg-[var(--sparo-panel,#171615)] content-stretch flex flex-col gap-[34px] items-start p-[96px] relative shrink-0 w-[1440px]" id="node-10-160" data-node-id="10:160" data-name="03 / How it works">
        <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:161">
          FROM DISCOVERY TO SETTLEMENT
        </p>
        <p className="[word-break:break-word] font-sans font-light leading-[60px] relative shrink-0 text-[40px] text-[color:var(--sparo-text,#f4f0eb)] w-[1248px]" data-node-id="10:162">
          Five stages. One shared set of terms.
        </p>
        <div className="content-stretch flex gap-[20px] items-center relative shrink-0 w-[1245px]" data-node-id="10:163" data-name="Five stages">
          <div className="content-stretch flex flex-col gap-[18px] items-start relative shrink-0 w-[233px]" data-node-id="10:164" data-name="Discover">
            <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:165">
              01
            </p>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[233px]" data-node-id="10:166" data-name="Divider" />
            <p className="[word-break:break-word] font-sans font-normal leading-[32px] relative shrink-0 text-[21px] text-[color:var(--sparo-text,#f4f0eb)] w-[233px]" data-node-id="10:167">
              Discover
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[233px]" data-node-id="10:168">
              Separate reference prices from authorized inventory.
            </p>
            <p className="[word-break:break-word] font-mono leading-[1.5] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] w-[233px] whitespace-pre-wrap" data-node-id="10:169">{`Market  ↗`}</p>
          </div>
          <div className="content-stretch flex flex-col gap-[18px] items-start relative shrink-0 w-[233px]" data-node-id="10:170" data-name="Clear">
            <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:171">
              02
            </p>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[233px]" data-node-id="10:172" data-name="Divider" />
            <p className="[word-break:break-word] font-sans font-normal leading-[32px] relative shrink-0 text-[21px] text-[color:var(--sparo-text,#f4f0eb)] w-[233px]" data-node-id="10:173">
              Clear
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[233px]" data-node-id="10:174">
              Compare direct resale and multi-party arrangements.
            </p>
            <p className="[word-break:break-word] font-mono leading-[1.5] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] w-[233px] whitespace-pre-wrap" data-node-id="10:175">{`Deals  ↗`}</p>
          </div>
          <div className="content-stretch flex flex-col gap-[18px] items-start relative shrink-0 w-[233px]" data-node-id="10:176" data-name="Approve">
            <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:177">
              03
            </p>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[233px]" data-node-id="10:178" data-name="Divider" />
            <p className="[word-break:break-word] font-sans font-normal leading-[32px] relative shrink-0 text-[21px] text-[color:var(--sparo-text,#f4f0eb)] w-[233px]" data-node-id="10:179">
              Approve
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[233px]" data-node-id="10:180">
              Every affected party signs the current version.
            </p>
            <p className="[word-break:break-word] font-mono leading-[1.5] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] w-[233px] whitespace-pre-wrap" data-node-id="10:181">{`Approvals  ↗`}</p>
          </div>
          <div className="content-stretch flex flex-col gap-[18px] items-start relative shrink-0 w-[233px]" data-node-id="10:182" data-name="Execute & verify">
            <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:183">
              04
            </p>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[233px]" data-node-id="10:184" data-name="Divider" />
            <p className="[word-break:break-word] font-sans font-normal leading-[32px] relative shrink-0 text-[21px] text-[color:var(--sparo-text,#f4f0eb)] w-[233px]" data-node-id="10:185">{`Execute & verify`}</p>
            <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[233px]" data-node-id="10:186">
              Run the job and inspect the evidence.
            </p>
            <p className="[word-break:break-word] font-mono leading-[1.5] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] w-[233px] whitespace-pre-wrap" data-node-id="10:187">{`Executions  ↗`}</p>
          </div>
          <div className="content-stretch flex flex-col gap-[18px] items-start relative shrink-0 w-[233px]" data-node-id="10:188" data-name="Settle">
            <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:189">
              05
            </p>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[233px]" data-node-id="10:190" data-name="Divider" />
            <p className="[word-break:break-word] font-sans font-normal leading-[32px] relative shrink-0 text-[21px] text-[color:var(--sparo-text,#f4f0eb)] w-[233px]" data-node-id="10:191">
              Settle
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[233px]" data-node-id="10:192">
              Approve payment. Record a balanced journal.
            </p>
            <p className="[word-break:break-word] font-mono leading-[1.5] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] w-[233px] whitespace-pre-wrap" data-node-id="10:193">{`Money  ↗`}</p>
          </div>
        </div>
      </div>
      <div className="bg-[var(--sparo-bg,#100f0e)] content-stretch flex flex-col gap-[32px] items-start p-[96px] relative shrink-0 w-[1440px]" data-node-id="10:194" data-name="04 / The deal explained">
        <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:195">
          A SHARED OUTCOME
        </p>
        <SparoDealComparison className="content-stretch flex flex-col gap-[28px] items-start relative shrink-0 w-[1248px]" state="Sparo cleared" />
        <div className="bg-[var(--sparo-raised,#201d1b)] content-stretch flex gap-[12px] items-start p-[16px] relative rounded-[8px] shrink-0 w-[1248px]" data-node-id="10:268" data-name="Provider authorization comes first.">
          <div className="relative shrink-0 size-[18px]" data-node-id="10:269" data-name="Icon / alert">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconAlert1} />
          </div>
          <div className="[word-break:break-word] content-stretch flex flex-col gap-[4px] items-start relative shrink-0 text-[color:var(--sparo-muted,#b6ada5)] w-[1186px]" data-node-id="10:271" data-name="Message">
            <p className="font-sans font-medium leading-[20px] relative shrink-0 text-[13px] w-[1186px]" data-node-id="10:272">
              Provider authorization comes first.
            </p>
            <p className="font-sans font-normal leading-[18px] relative shrink-0 text-[12px] w-[1186px]" data-node-id="10:273">
              Release and backfill are staged and recoverable. They are not atomic transfers, and no physical GPU moves.
            </p>
          </div>
        </div>
        <div className="content-stretch flex gap-[32px] items-center relative shrink-0 w-[1248px]" data-node-id="10:274" data-name="Multi-party extension">
          <div className="content-stretch flex flex-col gap-[16px] items-start relative shrink-0 w-[450px]" data-node-id="10:275" data-name="Four-party scenario">
            <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:276">
              WHEN MORE PARTIES FIT
            </p>
            <div className="[word-break:break-word] font-sans font-light leading-[0] relative shrink-0 text-[30px] text-[color:var(--sparo-text,#f4f0eb)] w-[450px]" data-node-id="10:277">
              <p className="leading-[45px] mb-0">A second buyer.</p>
              <p className="leading-[45px]">A wider opportunity.</p>
            </div>
            <p className="[word-break:break-word] font-sans font-normal leading-[1.5] relative shrink-0 text-[14px] text-[color:var(--sparo-muted,#b6ada5)] w-[450px]" data-node-id="10:278">
              The same approach can clear Acme and Brightlane with Northstar and Vertex. Each leg keeps its own contract, execution, invoice, and payment.
            </p>
            <a className="bg-[var(--sparo-bg,#100f0e)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch cursor-pointer flex h-[42px] items-center justify-center relative rounded-[999px] shrink-0 w-[270px]" data-nav="/deals" role="link" tabIndex={0} data-node-id="10:279" data-name="Button / Explore the four-party deal → execution">
              <p className="[word-break:break-word] font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] text-left whitespace-nowrap" data-node-id="I10:279;8:69">
                Explore the four-party deal
              </p>
            </a>
          </div>
          <div className="bg-[var(--sparo-panel,#171615)] h-[296px] relative shrink-0 w-[766px]" data-node-id="10:281" data-name="Cleared deal / graph">
            <div className="absolute h-[296px] left-0 top-0 w-[766px]" data-node-id="10:282" data-name="Frame">
              <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgFrame2} />
            </div>
            <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[24px] p-[14px] rounded-[12px] top-[30px] w-[178px]" data-node-id="10:284" data-name="Acme AI">
              <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="10:285">
                Acme AI
              </p>
              <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="10:286">
                Buyer · 6 × A100
              </p>
              <div className="bg-[var(--sparo-accentBg,#35231e)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[61px]" data-node-id="10:287" data-name="Status / Demand">
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] whitespace-nowrap" data-node-id="10:288">
                  Demand
                </p>
              </div>
            </div>
            <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[564px] p-[14px] rounded-[12px] top-[30px] w-[178px]" data-node-id="10:289" data-name="Northstar">
              <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="10:290">
                Northstar
              </p>
              <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="10:291">
                Capacity · A100
              </p>
              <div className="bg-[var(--sparo-accentBg,#35231e)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[74px]" data-node-id="10:292" data-name="Status / Authorized">
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] whitespace-nowrap" data-node-id="10:293">
                  Authorized
                </p>
              </div>
            </div>
            <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[24px] p-[14px] rounded-[12px] top-[174px] w-[178px]" data-node-id="10:294" data-name="Brightlane">
              <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="10:295">
                Brightlane
              </p>
              <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="10:296">
                Buyer · 2 × H100
              </p>
              <div className="bg-[var(--sparo-accentBg,#35231e)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[74px]" data-node-id="10:297" data-name="Status / Authorized">
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] whitespace-nowrap" data-node-id="10:298">
                  Demand
                </p>
              </div>
            </div>
            <div className="absolute bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[4px] items-start left-[564px] p-[14px] rounded-[12px] top-[174px] w-[178px]" data-node-id="10:299" data-name="Vertex">
              <p className="[word-break:break-word] font-sans font-medium leading-[21px] relative shrink-0 text-[14px] text-[color:var(--sparo-text,#f4f0eb)] w-[150px]" data-node-id="10:300">
                Vertex
              </p>
              <p className="[word-break:break-word] font-sans font-normal leading-[15px] relative shrink-0 text-[10px] text-[color:var(--sparo-muted,#b6ada5)] w-[150px]" data-node-id="10:301">
                Capacity · H100
              </p>
              <div className="bg-[var(--sparo-accentBg,#35231e)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[74px]" data-node-id="10:302" data-name="Status / Authorized">
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] whitespace-nowrap" data-node-id="10:303">
                  Authorized
                </p>
              </div>
            </div>
            <p className="[word-break:break-word] absolute font-mono leading-[15px] left-[24px] not-italic text-[10px] text-[color:var(--sparo-accent,#e4a28b)] top-[270px] w-[718px]" data-node-id="10:304">
              2 contracts · 2 executions
            </p>
          </div>
        </div>
      </div>
      <div className="bg-[var(--sparo-panel,#171615)] content-stretch flex flex-col gap-[32px] items-start p-[96px] relative shrink-0 w-[1440px]" data-node-id="10:305" data-name="05 / Market preview">
        <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:306">
          REFERENCE MARKET
        </p>
        <div className="content-stretch flex gap-[24px] items-center relative shrink-0 w-[1014px]" data-node-id="10:307" data-name="Market title">
          <p className="[word-break:break-word] font-sans font-light leading-[60px] relative shrink-0 text-[40px] text-[color:var(--sparo-text,#f4f0eb)] w-[900px]" data-node-id="10:308">
            See the spread. Find the opening.
          </p>
          <div className="bg-[var(--sparo-amberBg,#332a1c)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[90px]" data-node-id="10:309" data-name="Status / Static fallback">
            <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-amber,#e3c48f)] whitespace-nowrap" data-node-id="10:310">
              Static fallback
            </p>
          </div>
        </div>
        <div className="content-stretch flex flex-col items-start relative shrink-0 w-[1248px]" data-node-id="10:311" data-name="Reference prices">
          <div className="bg-[var(--sparo-raised,#201d1b)] content-stretch flex items-center py-[13px] relative shrink-0 w-[1248px]" data-node-id="10:312" data-name="Table header">
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[280px]" data-node-id="10:313" data-name="Provider">
              <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[258px]" data-node-id="10:314">
                PROVIDER
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:315" data-name="GPU">
              <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[198px]" data-node-id="10:316">
                GPU
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:317" data-name="Region">
              <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[198px]" data-node-id="10:318">
                REGION
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[190px]" data-node-id="10:319" data-name="$ / GPU-hr">
              <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[168px]" data-node-id="10:320">
                $ / GPU-HR
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[140px]" data-node-id="10:321" data-name="GPUs">
              <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[118px]" data-node-id="10:322">
                GPUS
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[198px]" data-node-id="10:323" data-name="Freshness">
              <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[176px]" data-node-id="10:324">
                FRESHNESS
              </p>
            </div>
          </div>
          <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[1248px]" data-node-id="10:325" data-name="Row / Nova Cloud">
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[280px]" data-node-id="10:326" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[255px]" data-node-id="10:327">
                Nova Cloud
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:328" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[195px]" data-node-id="10:329">
                A100 80GB
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:330" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[195px]" data-node-id="10:331">
                US East
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[190px]" data-node-id="10:332" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[165px]" data-node-id="10:333">
                $1.42
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[140px]" data-node-id="10:334" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[115px]" data-node-id="10:335">
                24
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[198px]" data-node-id="10:336" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[173px]" data-node-id="10:337">
                Observed 2m ago
              </p>
            </div>
          </div>
          <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:338" data-name="Divider" />
          <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[1248px]" data-node-id="10:339" data-name="Row / Atlas Compute">
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[280px]" data-node-id="10:340" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[255px]" data-node-id="10:341">
                Atlas Compute
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:342" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[195px]" data-node-id="10:343">
                A100 80GB
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:344" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[195px]" data-node-id="10:345">
                US West
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[190px]" data-node-id="10:346" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[165px]" data-node-id="10:347">
                $2.10
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[140px]" data-node-id="10:348" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[115px]" data-node-id="10:349">
                6
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[198px]" data-node-id="10:350" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[173px]" data-node-id="10:351">
                Observed 4m ago
              </p>
            </div>
          </div>
          <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:352" data-name="Divider" />
          <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[1248px]" data-node-id="10:353" data-name="Row / Northstar">
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[280px]" data-node-id="10:354" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[255px]" data-node-id="10:355">
                Northstar
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:356" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[195px]" data-node-id="10:357">
                A100 80GB
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:358" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[195px]" data-node-id="10:359">
                EU West
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[190px]" data-node-id="10:360" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[165px]" data-node-id="10:361">
                $2.85
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[140px]" data-node-id="10:362" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[115px]" data-node-id="10:363">
                16
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[198px]" data-node-id="10:364" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[173px]" data-node-id="10:365">
                Observed 6m ago
              </p>
            </div>
          </div>
          <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:366" data-name="Divider" />
          <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[1248px]" data-node-id="10:367" data-name="Row / Vertex">
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[280px]" data-node-id="10:368" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[255px]" data-node-id="10:369">
                Vertex
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:370" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[195px]" data-node-id="10:371">
                H100 SXM
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[220px]" data-node-id="10:372" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[195px]" data-node-id="10:373">
                US East
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[190px]" data-node-id="10:374" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[165px]" data-node-id="10:375">
                $3.95
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[140px]" data-node-id="10:376" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[115px]" data-node-id="10:377">
                8
              </p>
            </div>
            <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[198px]" data-node-id="10:378" data-name="Cell">
              <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[173px]" data-node-id="10:379">
                Stale · 2h ago
              </p>
            </div>
          </div>
          <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:380" data-name="Divider" />
        </div>
        <div className="content-stretch flex gap-[32px] items-center relative shrink-0 w-[1030px]" data-node-id="10:381" data-name="A100 spread">
          <p className="[word-break:break-word] font-mono leading-[1.5] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-subtle,#8e857d)] w-[290px]" data-node-id="10:382">
            A100 REFERENCE SPREAD
          </p>
          <p className="[word-break:break-word] font-sans font-normal leading-[38px] relative shrink-0 text-[25px] text-[color:var(--sparo-accent,#e4a28b)] whitespace-nowrap" data-node-id="10:383">
            $1.42
          </p>
          <div className="bg-[var(--sparo-line,#34302d)] h-[3px] relative shrink-0 w-[520px]" data-node-id="10:384" data-name="Spread" />
          <p className="[word-break:break-word] font-sans font-normal leading-[38px] relative shrink-0 text-[25px] text-[color:var(--sparo-text,#f4f0eb)] whitespace-nowrap" data-node-id="10:385">
            $3.50
          </p>
        </div>
        <p className="[word-break:break-word] font-sans font-normal leading-[18px] relative shrink-0 text-[12px] text-[color:var(--sparo-muted,#b6ada5)] w-[1248px]" data-node-id="10:386">
          Public listings are reference prices, never executable inventory. Preview uses labeled demo values.
        </p>
      </div>
      <div className="bg-[var(--sparo-bg,#100f0e)] content-stretch flex flex-col gap-[32px] items-start p-[96px] relative shrink-0 w-[1440px]" data-node-id="10:387" data-name="06 / Execution and verification">
        <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:388">
          EVIDENCE BEFORE PAYMENT
        </p>
        <div className="[word-break:break-word] font-sans font-light leading-[0] relative shrink-0 text-[48px] text-[color:var(--sparo-text,#f4f0eb)] w-[1248px]" data-node-id="10:389">
          <p className="leading-[72px] mb-0">No verification,</p>
          <p className="leading-[72px]">no payment.</p>
        </div>
        <div className="content-stretch flex gap-[40px] items-center relative shrink-0 w-[1248px]" data-node-id="10:390" data-name="Verification preview">
          <div className="bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[24px] items-start p-[28px] relative rounded-[12px] shrink-0 w-[770px]" data-node-id="10:391" data-name="Job timeline">
            <div className="bg-[var(--sparo-accentBg,#35231e)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[216px]" data-node-id="10:392" data-name="Status / Demo execution · real Docker container">
              <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] whitespace-nowrap" data-node-id="10:393">
                Demo execution · real Docker container
              </p>
            </div>
            <div className="content-stretch flex gap-[10px] items-center relative shrink-0 w-[710px]" data-node-id="10:394" data-name="Six steps">
              <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-[110px]" data-node-id="10:395" data-name="Approved">
                <div className="relative shrink-0 size-[18px]" data-node-id="10:396" data-name="Icon / check">
                  <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck1} />
                </div>
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] w-[108px]" data-node-id="10:398">
                  Approved
                </p>
              </div>
              <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-[110px]" data-node-id="10:399" data-name="Provisioning">
                <div className="relative shrink-0 size-[18px]" data-node-id="10:400" data-name="Icon / check">
                  <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck1} />
                </div>
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] w-[108px]" data-node-id="10:402">
                  Provisioning
                </p>
              </div>
              <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-[110px]" data-node-id="10:403" data-name="Running">
                <div className="relative shrink-0 size-[18px]" data-node-id="10:404" data-name="Icon / check">
                  <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck1} />
                </div>
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] w-[108px]" data-node-id="10:406">
                  Running
                </p>
              </div>
              <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-[110px]" data-node-id="10:407" data-name="Verifying">
                <div className="relative shrink-0 size-[18px]" data-node-id="10:408" data-name="Icon / check">
                  <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck1} />
                </div>
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] w-[108px]" data-node-id="10:410">
                  Verifying
                </p>
              </div>
              <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-[110px]" data-node-id="10:411" data-name="Payment pending">
                <div className="relative shrink-0 size-[18px]" data-node-id="10:412" data-name="Icon / check">
                  <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck1} />
                </div>
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] w-[108px]" data-node-id="10:414">
                  Payment pending
                </p>
              </div>
              <div className="content-stretch flex flex-col gap-[12px] items-start relative shrink-0 w-[110px]" data-node-id="10:415" data-name="Complete">
                <div className="relative shrink-0 size-[18px]" data-node-id="10:416" data-name="Icon / check">
                  <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck1} />
                </div>
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] w-[108px]" data-node-id="10:418">
                  Complete
                </p>
              </div>
            </div>
            <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[714px]" data-node-id="10:419" data-name="Divider" />
            <p className="[word-break:break-word] font-mono leading-[18px] not-italic relative shrink-0 text-[12px] text-[color:var(--sparo-muted,#b6ada5)] w-[714px]" data-node-id="10:420">
              job_a81c42
            </p>
            <p className="[word-break:break-word] font-sans font-normal leading-[30px] relative shrink-0 text-[20px] text-[color:var(--sparo-text,#f4f0eb)] w-[714px] whitespace-pre-wrap" data-node-id="10:421">{`Measured runtime   65s`}</p>
            <p className="[word-break:break-word] font-sans font-normal leading-[18px] relative shrink-0 text-[12px] text-[color:var(--sparo-subtle,#8e857d)] w-[714px]" data-node-id="10:422">
              Measured runtime is recorded separately from the contracted billing basis.
            </p>
          </div>
          <div className="content-stretch flex flex-col gap-[22px] items-start relative shrink-0 w-[438px]" data-node-id="10:423" data-name="Verification checks">
            <div className="content-stretch flex gap-[12px] items-center relative shrink-0 w-[432px]" data-node-id="10:424" data-name="Exit code is zero">
              <div className="relative shrink-0 size-[20px]" data-node-id="10:425" data-name="Icon / check">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck2} />
              </div>
              <p className="[word-break:break-word] font-sans font-normal leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-text,#f4f0eb)] w-[400px]" data-node-id="10:427">
                Exit code is zero
              </p>
            </div>
            <div className="content-stretch flex gap-[12px] items-center relative shrink-0 w-[432px]" data-node-id="10:428" data-name="Job ID matches the contract">
              <div className="relative shrink-0 size-[20px]" data-node-id="10:429" data-name="Icon / check">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck2} />
              </div>
              <p className="[word-break:break-word] font-sans font-normal leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-text,#f4f0eb)] w-[400px]" data-node-id="10:431">
                Job ID matches the contract
              </p>
            </div>
            <div className="content-stretch flex gap-[12px] items-center relative shrink-0 w-[432px]" data-node-id="10:432" data-name="Loss decreased as required">
              <div className="relative shrink-0 size-[20px]" data-node-id="10:433" data-name="Icon / check">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck2} />
              </div>
              <p className="[word-break:break-word] font-sans font-normal leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-text,#f4f0eb)] w-[400px]" data-node-id="10:435">
                Loss decreased as required
              </p>
            </div>
            <div className="content-stretch flex gap-[12px] items-center relative shrink-0 w-[432px]" data-node-id="10:436" data-name="Accuracy meets the threshold">
              <div className="relative shrink-0 size-[20px]" data-node-id="10:437" data-name="Icon / check">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgIconCheck2} />
              </div>
              <p className="[word-break:break-word] font-sans font-normal leading-[23px] relative shrink-0 text-[15px] text-[color:var(--sparo-text,#f4f0eb)] w-[400px]" data-node-id="10:439">
                Accuracy meets the threshold
              </p>
            </div>
            <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[438px]" data-node-id="10:440">
              Every check must pass before payment can proceed.
            </p>
          </div>
        </div>
      </div>
      <div className="bg-[var(--sparo-panel,#171615)] content-stretch flex flex-col gap-[32px] items-start p-[96px] relative shrink-0 w-[1440px]" id="node-10-441" data-node-id="10:441" data-name="07 / Money and controls">
        <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:442">
          TRUST YOU CAN INSPECT
        </p>
        <div className="[word-break:break-word] font-sans font-light leading-[0] relative shrink-0 text-[40px] text-[color:var(--sparo-text,#f4f0eb)] w-[1248px]" data-node-id="10:443">
          <p className="leading-[60px] mb-0">Every approval has an owner.</p>
          <p className="leading-[60px]">Every dollar has a counter-entry.</p>
        </div>
        <div className="content-stretch flex gap-[48px] items-center relative shrink-0 w-[1248px]" data-node-id="10:444" data-name="Ledger and controls">
          <div className="bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[20px] items-start p-[24px] relative rounded-[12px] shrink-0 w-[660px]" data-node-id="10:445" data-name="Ledger preview">
            <div className="content-stretch flex gap-[24px] items-center relative shrink-0 w-[509px]" data-node-id="10:446" data-name="Balanced total">
              <p className="[word-break:break-word] font-sans font-normal leading-[30px] relative shrink-0 text-[20px] text-[color:var(--sparo-text,#f4f0eb)] w-[420px]" data-node-id="10:447">
                Trial balance
              </p>
              <div className="bg-[var(--sparo-greenBg,#1c2d24)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[65px]" data-node-id="10:448" data-name="Status / Balanced">
                <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-green,#a5ccb4)] whitespace-nowrap" data-node-id="10:449">
                  Balanced
                </p>
              </div>
            </div>
            <div className="content-stretch flex flex-col items-start relative shrink-0 w-[612px]" data-node-id="10:450" data-name="Ledger snippet">
              <div className="bg-[var(--sparo-raised,#201d1b)] content-stretch flex items-center py-[13px] relative shrink-0 w-[612px]" data-node-id="10:451" data-name="Table header">
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[352px]" data-node-id="10:452" data-name="Account">
                  <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[330px]" data-node-id="10:453">
                    ACCOUNT
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:454" data-name="Debit">
                  <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[108px]" data-node-id="10:455">
                    DEBIT
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:456" data-name="Credit">
                  <p className="[word-break:break-word] font-mono leading-[15px] not-italic relative shrink-0 text-[10px] text-[color:var(--sparo-subtle,#8e857d)] w-[108px]" data-node-id="10:457">
                    CREDIT
                  </p>
                </div>
              </div>
              <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[612px]" data-node-id="10:458" data-name="Row / 1000 · Cash">
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[352px]" data-node-id="10:459" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[327px]" data-node-id="10:460">
                    1000 · Cash
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:461" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:462">
                    $623.00
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:463" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:464">
                    —
                  </p>
                </div>
              </div>
              <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[612px]" data-node-id="10:465" data-name="Divider" />
              <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[612px]" data-node-id="10:466" data-name="Row / 1100 · Receivables">
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[352px]" data-node-id="10:467" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[327px]" data-node-id="10:468">
                    1100 · Receivables
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:469" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:470">
                    $326.00
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:471" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:472">
                    —
                  </p>
                </div>
              </div>
              <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[612px]" data-node-id="10:473" data-name="Divider" />
              <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[612px]" data-node-id="10:474" data-name="Row / 2000 · Payables">
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[352px]" data-node-id="10:475" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[327px]" data-node-id="10:476">
                    2000 · Payables
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:477" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:478">
                    —
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:479" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:480">
                    $420.00
                  </p>
                </div>
              </div>
              <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[612px]" data-node-id="10:481" data-name="Divider" />
              <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[612px]" data-node-id="10:482" data-name="Row / 4000 · Clearing income">
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[352px]" data-node-id="10:483" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[327px]" data-node-id="10:484">
                    4000 · Clearing income
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:485" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:486">
                    —
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:487" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:488">
                    $529.00
                  </p>
                </div>
              </div>
              <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[612px]" data-node-id="10:489" data-name="Divider" />
              <div className="content-stretch flex items-center py-[16px] relative shrink-0 w-[612px]" data-node-id="10:490" data-name="Row / Total">
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[352px]" data-node-id="10:491" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-text,#f4f0eb)] w-[327px]" data-node-id="10:492">
                    Total
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:493" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:494">
                    $949.00
                  </p>
                </div>
                <div className="content-stretch flex flex-col items-start pl-[16px] relative shrink-0 w-[130px]" data-node-id="10:495" data-name="Cell">
                  <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[105px]" data-node-id="10:496">
                    $949.00
                  </p>
                </div>
              </div>
              <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[612px]" data-node-id="10:497" data-name="Divider" />
            </div>
          </div>
          <div className="[word-break:break-word] content-stretch flex flex-col font-sans font-normal gap-[24px] items-start relative shrink-0 w-[540px]" data-node-id="10:498" data-name="Control rules">
            <div className="content-stretch flex flex-col gap-[6px] items-start relative shrink-0 w-[540px]" data-node-id="10:499" data-name="Separate duties">
              <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[540px]" data-node-id="10:500">
                Separate duties
              </p>
              <p className="leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[540px]" data-node-id="10:501">
                Requesters cannot approve their own restricted actions.
              </p>
            </div>
            <div className="content-stretch flex flex-col gap-[6px] items-start relative shrink-0 w-[540px]" data-node-id="10:502" data-name="Scope every signature">
              <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[540px]" data-node-id="10:503">
                Scope every signature
              </p>
              <p className="leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[540px]" data-node-id="10:504">
                A version change invalidates previous approvals.
              </p>
            </div>
            <div className="content-stretch flex flex-col gap-[6px] items-start relative shrink-0 w-[540px]" data-node-id="10:505" data-name="Explain every block">
              <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[540px]" data-node-id="10:506">
                Explain every block
              </p>
              <p className="leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[540px]" data-node-id="10:507">
                A blocked payment links directly to its exception.
              </p>
            </div>
            <div className="content-stretch flex flex-col gap-[6px] items-start relative shrink-0 w-[540px]" data-node-id="10:508" data-name="Keep the audit trail">
              <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[540px]" data-node-id="10:509">
                Keep the audit trail
              </p>
              <p className="leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[540px]" data-node-id="10:510">
                Every write records its actor, entity, and time.
              </p>
            </div>
          </div>
        </div>
        <p className="[word-break:break-word] font-sans font-normal leading-[18px] relative shrink-0 text-[12px] text-[color:var(--sparo-muted,#b6ada5)] w-[1248px]" data-node-id="10:511">
          Testnet settlement only. Invoice value and on-chain value are shown separately. No real funds.
        </p>
      </div>
      <div className="[word-break:break-word] bg-[var(--sparo-bg,#100f0e)] content-stretch flex flex-col gap-[32px] items-start p-[96px] relative shrink-0 w-[1440px]" data-node-id="10:512" data-name="08 / Who it is for">
        <p className="font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:513">
          DIFFERENT ROLES. SHARED CLARITY.
        </p>
        <div className="content-stretch flex gap-[24px] items-center relative shrink-0 w-[1248px]" data-node-id="10:514" data-name="Audience cards">
          <div className="bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[22px] items-start p-[28px] relative rounded-[12px] shrink-0 w-[400px]" data-node-id="10:515" data-name="Buyers">
            <p className="font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:516">
              BUYERS
            </p>
            <p className="font-sans font-normal leading-[38px] relative shrink-0 text-[25px] text-[color:var(--sparo-text,#f4f0eb)] w-[344px]" data-node-id="10:517">
              Get the compute your deadline needs.
            </p>
            <p className="font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[344px] whitespace-pre-wrap" data-node-id="10:518">{`—  Compare against independent rental`}</p>
            <p className="font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[344px] whitespace-pre-wrap" data-node-id="10:519">{`—  Approve exactly what you will pay`}</p>
            <p className="font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[344px] whitespace-pre-wrap" data-node-id="10:520">{`—  Inspect verified execution evidence`}</p>
          </div>
          <div className="bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[22px] items-start p-[28px] relative rounded-[12px] shrink-0 w-[400px]" data-node-id="10:521" data-name="Capacity holders">
            <p className="font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:522">
              CAPACITY HOLDERS
            </p>
            <p className="font-sans font-normal leading-[38px] relative shrink-0 text-[25px] text-[color:var(--sparo-text,#f4f0eb)] w-[344px]" data-node-id="10:523">
              Put a paid commitment to work.
            </p>
            <p className="font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[344px] whitespace-pre-wrap" data-node-id="10:524">{`—  Find demand for idle capacity`}</p>
            <p className="font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[344px] whitespace-pre-wrap" data-node-id="10:525">{`—  Approve release and backfill together`}</p>
            <p className="font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[344px] whitespace-pre-wrap" data-node-id="10:526">{`—  Track what is owed and paid`}</p>
          </div>
          <div className="bg-[var(--sparo-panel,#171615)] border border-[var(--sparo-line,#34302d)] border-solid content-stretch flex flex-col gap-[22px] items-start p-[28px] relative rounded-[12px] shrink-0 w-[400px]" data-node-id="10:527" data-name="Finance teams">
            <p className="font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:528">
              FINANCE TEAMS
            </p>
            <p className="font-sans font-normal leading-[38px] relative shrink-0 text-[25px] text-[color:var(--sparo-text,#f4f0eb)] w-[344px]" data-node-id="10:529">
              Close the loop with confidence.
            </p>
            <p className="font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[344px] whitespace-pre-wrap" data-node-id="10:530">{`—  Review invoices and exceptions`}</p>
            <p className="font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[344px] whitespace-pre-wrap" data-node-id="10:531">{`—  Approve payments with separation of duties`}</p>
            <p className="font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] w-[344px] whitespace-pre-wrap" data-node-id="10:532">{`—  Reconcile a balanced journal`}</p>
          </div>
        </div>
      </div>
      <div className="bg-[var(--sparo-panel,#171615)] content-stretch flex flex-col gap-[32px] items-start p-[96px] relative shrink-0 w-[1440px]" data-node-id="10:533" data-name="09 / Questions">
        <p className="[word-break:break-word] font-mono leading-[17px] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-accent,#e4a28b)] tracking-[1.3px] whitespace-nowrap" data-node-id="10:534">
          A FEW THINGS TO KNOW
        </p>
        <p className="[word-break:break-word] font-sans font-light leading-[60px] relative shrink-0 text-[40px] text-[color:var(--sparo-text,#f4f0eb)] w-[1248px]" data-node-id="10:535">
          Clarity comes with the territory.
        </p>
        <div className="[word-break:break-word] content-stretch flex font-sans font-normal gap-[40px] items-center relative shrink-0 w-[1210px]" data-node-id="10:536" data-name="Is this real-money trading?">
          <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[490px]" data-node-id="10:537">
            Is this real-money trading?
          </p>
          <p className="leading-[1.5] relative shrink-0 text-[14px] text-[color:var(--sparo-muted,#b6ada5)] w-[680px]" data-node-id="10:538">
            No. The demo uses testnet settlement and seeded data. No real funds are at risk.
          </p>
        </div>
        <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:539" data-name="Divider" />
        <div className="[word-break:break-word] content-stretch flex font-sans font-normal gap-[40px] items-center relative shrink-0 w-[1210px]" data-node-id="10:540" data-name="Do GPUs physically move?">
          <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[490px]" data-node-id="10:541">
            Do GPUs physically move?
          </p>
          <p className="leading-[1.5] relative shrink-0 text-[14px] text-[color:var(--sparo-muted,#b6ada5)] w-[680px]" data-node-id="10:542">
            No. Provider-authorized capacity handoffs are staged and recoverable.
          </p>
        </div>
        <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:543" data-name="Divider" />
        <div className="[word-break:break-word] content-stretch flex font-sans font-normal gap-[40px] items-center relative shrink-0 w-[1210px]" data-node-id="10:544" data-name="What if the terms change?">
          <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[490px]" data-node-id="10:545">
            What if the terms change?
          </p>
          <p className="leading-[1.5] relative shrink-0 text-[14px] text-[color:var(--sparo-muted,#b6ada5)] w-[680px]" data-node-id="10:546">
            A new version invalidates earlier approvals. Every affected party reviews and signs again.
          </p>
        </div>
        <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:547" data-name="Divider" />
        <div className="[word-break:break-word] content-stretch flex font-sans font-normal gap-[40px] items-center relative shrink-0 w-[1210px]" data-node-id="10:548" data-name="Does an AI decide the price?">
          <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[490px]" data-node-id="10:549">
            Does an AI decide the price?
          </p>
          <p className="leading-[1.5] relative shrink-0 text-[14px] text-[color:var(--sparo-muted,#b6ada5)] w-[680px]" data-node-id="10:550">
            No. A deterministic solver decides feasibility. CREAO coordinates work; it does not price deals.
          </p>
        </div>
        <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:551" data-name="Divider" />
        <div className="[word-break:break-word] content-stretch flex font-sans font-normal gap-[40px] items-center relative shrink-0 w-[1210px]" data-node-id="10:552" data-name="What happens when verification fails?">
          <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[490px]" data-node-id="10:553">
            What happens when verification fails?
          </p>
          <p className="leading-[1.5] relative shrink-0 text-[14px] text-[color:var(--sparo-muted,#b6ada5)] w-[680px]" data-node-id="10:554">
            The job shows the failed check and payment remains blocked.
          </p>
        </div>
        <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:555" data-name="Divider" />
        <div className="[word-break:break-word] content-stretch flex font-sans font-normal gap-[40px] items-center relative shrink-0 w-[1210px]" data-node-id="10:556" data-name="Why is there no login?">
          <p className="leading-[27px] relative shrink-0 text-[18px] text-[color:var(--sparo-text,#f4f0eb)] w-[490px]" data-node-id="10:557">
            Why is there no login?
          </p>
          <p className="leading-[1.5] relative shrink-0 text-[14px] text-[color:var(--sparo-muted,#b6ada5)] w-[680px]" data-node-id="10:558">
            Observer access needs no sign-in. Human decisions require your participant credential; it stays on the server.
          </p>
        </div>
        <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1248px]" data-node-id="10:559" data-name="Divider" />
      </div>
      <div className="bg-[var(--sparo-bg,#100f0e)] content-stretch flex flex-col gap-[28px] items-center p-[96px] relative shrink-0 w-[1440px]" data-node-id="10:560" data-name="10 / Final invitation">
        <div className="overflow-clip relative shrink-0 size-[74px]" data-node-id="10:561" data-name="Sparo / Stacked S">
          <div className="absolute inset-[6.25%_1.25%_8.75%_0]" data-node-id="10:562" data-name="Group">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgGroup1} />
          </div>
        </div>
        <p className="[word-break:break-word] font-sans font-light leading-[72px] relative shrink-0 text-[48px] text-[color:var(--sparo-text,#f4f0eb)] text-center w-[1248px]" data-node-id="10:570">
          Walk the whole deal yourself.
        </p>
        <div className="bg-[var(--sparo-accent,#e4a28b)] content-stretch flex h-[42px] items-center justify-center relative rounded-[999px] shrink-0 w-[290px]" data-nav="/" role="link" tabIndex={0} data-node-id="10:571" data-name="Button / Open the demo dashboard  → → overview">
          <p className="[word-break:break-word] font-sans font-medium leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-bg,#100f0e)] whitespace-pre" data-node-id="I10:571;8:67">{`Open the demo dashboard  →`}</p>
        </div>
        <p className="[word-break:break-word] font-mono leading-[1.5] not-italic relative shrink-0 text-[11px] text-[color:var(--sparo-muted,#b6ada5)] text-center w-[1248px] whitespace-pre-wrap" data-node-id="10:573">{`SEEDED DATA  /  TESTNET RAILS  /  NO SIGN-IN`}</p>
      </div>
      <div className="bg-[var(--sparo-panel,#171615)] content-stretch flex flex-col gap-[24px] items-start p-[64px] relative shrink-0 w-[1440px]" data-node-id="10:574" data-name="Footer">
        <div className="content-stretch flex gap-[30px] items-center relative shrink-0 w-[614px]" data-node-id="10:575" data-name="Footer navigation">
          <div className="content-stretch flex gap-[10px] items-center relative shrink-0 w-[107px]" data-node-id="10:576" data-name="Sparo wordmark">
            <div className="overflow-clip relative shrink-0 size-[30px]" data-node-id="10:577" data-name="Sparo / Stacked S">
              <div className="absolute inset-[6.25%_1.25%_8.75%_0]" data-node-id="10:578" data-name="Group">
                <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgGroup} />
              </div>
            </div>
            <p className="[word-break:break-word] font-sans font-medium leading-[35px] relative shrink-0 text-[23px] text-[color:var(--sparo-text,#f4f0eb)] tracking-[1.4px] whitespace-nowrap" data-node-id="10:586">
              sparo
            </p>
          </div>
          <button className="[word-break:break-word] block cursor-pointer font-sans font-normal leading-[0] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] text-left whitespace-nowrap" data-nav="/market" role="link" tabIndex={0} data-node-id="10:587">
            <p className="leading-[20px]">Market</p>
          </button>
          <button className="[word-break:break-word] block cursor-pointer font-sans font-normal leading-[0] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] text-left whitespace-nowrap" data-nav="/system" role="link" tabIndex={0} data-node-id="10:588">
            <p className="leading-[20px]">Controls</p>
          </button>
          <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] whitespace-nowrap" data-nav="https://github.com/DheekshaBaskaran/SpareChange#readme" role="link" tabIndex={0} data-node-id="10:589">
            Documentation
          </p>
          <p className="[word-break:break-word] font-sans font-normal leading-[20px] relative shrink-0 text-[13px] text-[color:var(--sparo-muted,#b6ada5)] whitespace-nowrap" data-nav="/system" role="link" tabIndex={0} data-node-id="10:590">
            System status
          </p>
          <div className="bg-[var(--sparo-greenBg,#1c2d24)] content-stretch flex items-start px-[9px] py-[4px] relative rounded-[6px] shrink-0 w-[81px]" data-node-id="10:591" data-name="Status / Demo preview">
            <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-green,#a5ccb4)] whitespace-nowrap" data-node-id="10:592">
              Demo online
            </p>
          </div>
        </div>
        <div className="bg-[var(--sparo-line,#34302d)] h-px relative shrink-0 w-[1312px]" data-node-id="10:593" data-name="Divider" />
        <p className="[word-break:break-word] font-sans font-normal leading-[17px] relative shrink-0 text-[11px] text-[color:var(--sparo-subtle,#8e857d)] w-[1312px] whitespace-pre-wrap" data-node-id="10:594">{`© 2026 Sparo.   Demo-scale clearinghouse for AI compute.   Reference prices are not confirmed inventory.   No real funds.`}</p>
      </div>
    </div>
  );
}
