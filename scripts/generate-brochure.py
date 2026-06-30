from fpdf import FPDF
from fpdf.enums import XPos, YPos
import os

OUTPUT = "artifacts/snapserve-book/public/brochure/snapserve-brochure.pdf"

BRAND  = (108, 99, 255)
ACCENT = ( 16,185,129)
DARK   = ( 15, 15, 26)
DARK2  = ( 30, 30, 53)
WHITE  = (255,255,255)
LBG    = (248,250,252)
BORDER = (226,232,240)
TEXT   = ( 15, 23, 42)
MUTED  = (100,116,139)
ORANGE = (245,158, 11)
RED    = (239, 68, 68)

class Brochure(FPDF):
    def header(self): pass
    def footer(self): pass

    def fr(self, x, y, w, h, r, g, b):
        self.set_fill_color(r, g, b)
        self.set_draw_color(r, g, b)
        self.rect(x, y, w, h, "F")

    def frd(self, x, y, w, h, fr, fg, fb, br, bg2, bb):
        self.set_fill_color(fr, fg, fb)
        self.set_draw_color(br, bg2, bb)
        self.rect(x, y, w, h, "FD")

    def header_bar(self, page_num, total=7):
        self.fr(0, 0, 210, 14, *DARK)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*WHITE)
        self.set_xy(10, 3.5)
        self.cell(0, 7, "SnapServe  -  AI Voice Platform", new_x=XPos.LMARGIN)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.set_xy(10, 3.5)
        self.cell(190, 7, f"Page {page_num} of {total}", align="R")

    def footer_bar(self):
        self.set_draw_color(*BORDER)
        self.line(10, 282, 200, 282)
        self.set_font("Helvetica", "", 7.5)
        self.set_text_color(*MUTED)
        self.set_xy(10, 283)
        self.cell(0, 5, "(c) 2026 SnapServe.  All rights reserved.  Confidential.", new_x=XPos.LMARGIN)
        self.set_xy(10, 283)
        self.cell(190, 5, "snapserve.ai", align="R")

    def eyebrow(self, x, y, text):
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(*BRAND)
        self.set_xy(x, y)
        self.cell(0, 5, text.upper())

    def stitle(self, x, y, text, size=18):
        self.set_font("Helvetica", "B", size)
        self.set_text_color(*TEXT)
        self.set_xy(x, y)
        self.cell(0, 8, text)

    def body(self, x, y, w, text, size=9.5):
        self.set_font("Helvetica", "", size)
        self.set_text_color(*MUTED)
        self.set_xy(x, y)
        self.multi_cell(w, 5, text)

    def card(self, x, y, w, h, accent=False):
        bg = (240,244,255) if accent else LBG
        bc = (199,210,254) if accent else BORDER
        self.frd(x, y, w, h, *bg, *bc)

    def dark_band(self, x, y, w, h):
        self.fr(x, y, w, h, *DARK)


pdf = Brochure(orientation="P", unit="mm", format="A4")
pdf.set_auto_page_break(False)
pdf.set_margins(0, 0, 0)

# PAGE 1 - COVER
pdf.add_page()
pdf.fr(0, 0, 210, 297, *DARK)
pdf.fr(0, 0, 210, 4, *BRAND)

pdf.fr(12, 14, 22, 22, *BRAND)
pdf.set_font("Helvetica", "B", 14); pdf.set_text_color(*WHITE)
pdf.set_xy(12, 14); pdf.cell(22, 22, "S", align="C")
pdf.set_font("Helvetica", "B", 16); pdf.set_text_color(*WHITE)
pdf.set_xy(38, 17); pdf.cell(0, 7, "SnapServe")
pdf.set_font("Helvetica", "", 8); pdf.set_text_color(*MUTED)
pdf.set_xy(38, 25); pdf.cell(0, 5, "AI VOICE PLATFORM")

pdf.fr(140, 15, 58, 9, 30, 30, 80)
pdf.set_font("Helvetica", "B", 7.5); pdf.set_text_color(165,180,252)
pdf.set_xy(140, 15); pdf.cell(58, 9, "Product Brochure  2026", align="C")

pdf.set_font("Helvetica", "B", 9); pdf.set_text_color(*ACCENT)
pdf.set_xy(10, 80); pdf.cell(190, 6, "ENTERPRISE AI VOICE AGENTS", align="C")

pdf.set_font("Helvetica", "B", 38); pdf.set_text_color(*WHITE)
pdf.set_xy(10, 90); pdf.cell(190, 18, "Your Business,", align="C")
pdf.set_text_color(*BRAND)
pdf.set_xy(10, 108); pdf.cell(190, 18, "Speaking Smarter.", align="C")

pdf.set_font("Helvetica", "", 12); pdf.set_text_color(148,163,184)
pdf.set_xy(25, 132)
pdf.multi_cell(160, 6.5,
    "SnapServe is an AI voice agent orchestration platform that lets you deploy\n"
    "intelligent, multilingual voice agents in minutes - no engineering team required.")

pills = ["Multilingual STT", "LLM Orchestration", "Any Telephony", "Caller Memory", "Smart Scheduling"]
px = 15
for p in pills:
    pdf.set_font("Helvetica", "B", 7.5)
    tw = pdf.get_string_width(p) + 12
    pdf.fr(px, 162, tw, 9, 40, 40, 70)
    pdf.set_text_color(203,213,225)
    pdf.set_xy(px, 162.5); pdf.cell(tw, 8, p, align="C")
    px += tw + 5

stats = [("$0.05 /min","Fully Managed"), ("4+","Telephony Providers"), ("10+","AI Integrations")]
bx = 12
for val, lbl in stats:
    pdf.fr(bx, 190, 58, 36, 22, 22, 40)
    pdf.set_font("Helvetica", "B", 18); pdf.set_text_color(*WHITE)
    pdf.set_xy(bx, 196); pdf.cell(58, 10, val, align="C")
    pdf.set_font("Helvetica", "", 7.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(bx, 208); pdf.cell(58, 5, lbl, align="C")
    bx += 62

pdf.set_draw_color(40,40,70); pdf.line(12,250,198,250)
pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
pdf.set_xy(12,252); pdf.cell(0,5,"Confidential - For Client Use Only - 2026")
pdf.set_text_color(*BRAND); pdf.set_xy(12,252); pdf.cell(186,5,"snapserve.ai",align="R")


# PAGE 2 - WHAT IS SNAPSERVE
pdf.add_page()
pdf.header_bar(2)
pdf.eyebrow(12,22,"Overview")
pdf.stitle(12,29,"What is SnapServe?")
pdf.body(12,40,186,
    "SnapServe is an AI voice agent orchestration platform. It sits between your telephony provider and AI models - "
    "handling everything from speech recognition to response generation to text-to-speech - so your agents can "
    "have natural, intelligent conversations over any phone call.")

cards = [
    ("STT","Speech Recognition",
     "Real-time transcription via Deepgram, Azure, Whisper & Sarvam. Supports Hindi, Tamil, Telugu, Malayalam, English and more.",True),
    ("LLM","Conversation Engine",
     "Powered by OpenAI, Anthropic, DeepSeek, Mistral or Cohere. Custom system prompts, tools and personas per agent.",False),
    ("TTS","Text-to-Speech",
     "Natural voice via ElevenLabs, OpenAI, AWS Polly, Azure, Cartesia or Deepgram. Choose the voice that fits your brand.",False),
    ("TEL","Telephony",
     "Works with Twilio, Plivo, VoBiz and Vonage. Handles inbound calls, outbound campaigns, warm transfers and IVR flows.",False),
    ("MEM","Caller Memory",
     "Remembers facts, preferences and history across every call. Never asks the same question twice. Greets callers by name.",False),
    ("CAL","Smart Scheduling",
     "Built-in booking engine with Google Calendar sync, availability windows, slot management and email notifications.",False),
]
cy = 68
for i,(ico,title,desc,acc) in enumerate(cards):
    cx = 12 if i%2==0 else 109
    ry = cy + (i//2)*50
    pdf.card(cx, ry, 95, 46, acc)
    badge_c = (199,210,254) if acc else (226,232,240)
    pdf.fr(cx+5, ry+5, 12, 12, *badge_c)
    pdf.set_font("Helvetica","B",7); pdf.set_text_color(*BRAND if acc else TEXT)
    pdf.set_xy(cx+5,ry+6); pdf.cell(12,9,ico,align="C")
    pdf.set_font("Helvetica","B",9); pdf.set_text_color(*TEXT)
    pdf.set_xy(cx+5,ry+20); pdf.cell(85,5,title)
    pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
    pdf.set_xy(cx+5,ry+27); pdf.multi_cell(85,4.5,desc)

qy = cy+3*50+6
pdf.fr(12,qy,5,20,*BRAND)
pdf.frd(17,qy,181,20,240,244,255,199,210,254)
pdf.set_font("Helvetica","I",9.5); pdf.set_text_color(55,65,81)
pdf.set_xy(21,qy+3)
pdf.multi_cell(174,5,
    '"Deploy your first AI voice agent in under 10 minutes. No engineering team. '
    'No complex integrations. Just configure, connect, and go live."')
pdf.footer_bar()


# PAGE 3 - HOW IT WORKS
pdf.add_page()
pdf.header_bar(3)
pdf.eyebrow(12,22,"Architecture")
pdf.stitle(12,29,"How It Works")
pdf.body(12,40,186,
    "Every call flows through SnapServe's orchestration pipeline in real time - from the first ring to the final goodbye.")

pdf.dark_band(12,54,186,68)
nodes=["Caller","Telephony","SnapServe\n(Core)","ASR","LLM","TTS","Caller"]
nw=24; gap=4; nx=16
for j,nd in enumerate(nodes):
    is_core=nd.startswith("Snap")
    bc=BRAND if is_core else (42,42,69)
    pdf.fr(nx,58,nw,18,*bc)
    if is_core:
        pdf.set_draw_color(*BRAND); pdf.rect(nx,58,nw,18,"D")
    pdf.set_font("Helvetica","B" if is_core else "",6.5)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(nx,62); pdf.cell(nw,5,nd.split("\n")[0],align="C")
    if "\n" in nd:
        pdf.set_xy(nx,67); pdf.cell(nw,4,nd.split("\n")[1],align="C")
    if j<len(nodes)-1:
        pdf.set_font("Helvetica","B",9); pdf.set_text_color(*BRAND)
        pdf.set_xy(nx+nw,62); pdf.cell(gap,5,">",align="C")
    nx+=nw+gap

cols2=[("STT Providers",["Deepgram","Azure","Whisper","Sarvam"]),
      ("LLM Providers",["OpenAI","Anthropic","DeepSeek","Mistral"]),
      ("TTS Providers",["ElevenLabs","OpenAI","AWS Polly","Azure"]),
      ("Telephony",["Twilio","Plivo","VoBiz","Vonage"])]
cw2=44; cx2=16
for col_t,vals in cols2:
    pdf.set_font("Helvetica","B",7); pdf.set_text_color(*BRAND)
    pdf.set_xy(cx2,80); pdf.cell(cw2,5,col_t,align="C")
    pdf.set_font("Helvetica","",7); pdf.set_text_color(148,163,184)
    for vi,v in enumerate(vals):
        pdf.set_xy(cx2,86+vi*5); pdf.cell(cw2,4.5,v,align="C")
    cx2+=cw2+2

steps=[
    ("1","Call Arrives",
     "A caller dials in (or your campaign dials out). The telephony provider routes the call to SnapServe and opens a real-time audio stream."),
    ("2","Speech is Transcribed",
     "The caller's voice is streamed to the ASR provider. Transcription is returned in under 500 ms with full support for Indic and multilingual speech."),
    ("3","AI Generates a Response",
     "The transcript is sent to the LLM with your agent's persona, system prompt, caller memory and any business tools. The AI decides what to say or what action to take."),
    ("4","Voice is Synthesised",
     "The AI response is converted to natural-sounding speech and streamed back to the caller in real time. Barge-in detection lets callers interrupt naturally."),
    ("5","Memory & Analytics Updated",
     "After the call, SnapServe summarises the conversation, updates the caller's memory profile, logs outcomes and triggers configured webhooks or CRM updates."),
]
sy=130
for s_num,s_title,s_desc in steps:
    pdf.set_fill_color(*BRAND); pdf.set_draw_color(*BRAND)
    pdf.ellipse(12,sy,9,9,"F")
    pdf.set_font("Helvetica","B",8); pdf.set_text_color(*WHITE)
    pdf.set_xy(12,sy+1); pdf.cell(9,6.5,s_num,align="C")
    if s_num!="5":
        pdf.set_draw_color(*BRAND); pdf.line(16.5,sy+9,16.5,sy+21)
    pdf.set_font("Helvetica","B",9.5); pdf.set_text_color(*TEXT)
    pdf.set_xy(26,sy+0.5); pdf.cell(0,5,s_title)
    pdf.set_font("Helvetica","",8.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(26,sy+6); pdf.multi_cell(170,4.5,s_desc)
    sy+=24
pdf.footer_bar()


# PAGE 4 - USE CASES
pdf.add_page()
pdf.header_bar(4)
pdf.eyebrow(12,22,"Applications")
pdf.stitle(12,29,"Who Uses SnapServe?")
pdf.body(12,40,186,
    "From financial services to healthcare, SnapServe powers voice agents across every industry that needs to talk to customers at scale.")

use_cases=[
    ("BFSI","Banking & Finance","Loan follow-up, EMI reminders, KYC collection, balance enquiry, payment confirmations."),
    ("HLTH","Healthcare","Appointment booking, prescription reminders, lab result notifications, patient follow-up calls."),
    ("ECOM","E-Commerce","Order status, delivery confirmations, return initiations, post-purchase satisfaction calls."),
    ("REAL","Real Estate","Lead qualification, site visit scheduling, property inquiry handling, follow-up automation."),
    ("TELCO","Telecom & Utilities","Outage notifications, bill reminders, service renewal calls, complaint triage."),
    ("EDTCH","EdTech","Admission follow-up, class reminders, parent communication, student support lines."),
    ("AUTO","Automotive","Test drive scheduling, service reminders, lead follow-up from dealership inquiries."),
    ("INSUR","Insurance","Policy renewal reminders, claim updates, premium collection, customer onboarding calls."),
    ("SALES","Sales & Collections","Outbound campaign dialing, lead scoring by outcome, warm transfer to human agents."),
]
cx_u,cy_u,cw_u,ch_u=12,56,58,42
for i,(ico,title,desc) in enumerate(use_cases):
    col=i%3; row=i//3
    cx=cx_u+col*(cw_u+4); cy=cy_u+row*(ch_u+4)
    pdf.frd(cx,cy,cw_u,ch_u,*LBG,*BORDER)
    pdf.fr(cx+cw_u/2-6,cy+4,12,10,*BORDER)
    pdf.set_font("Helvetica","B",6); pdf.set_text_color(*BRAND)
    pdf.set_xy(cx+cw_u/2-6,cy+5.5); pdf.cell(12,7,ico,align="C")
    pdf.set_font("Helvetica","B",8); pdf.set_text_color(*TEXT)
    pdf.set_xy(cx+4,cy+16); pdf.cell(cw_u-8,5,title,align="C")
    pdf.set_font("Helvetica","",7); pdf.set_text_color(*MUTED)
    pdf.set_xy(cx+3,cy+22); pdf.multi_cell(cw_u-6,4,desc)

mby=cy_u+3*(ch_u+4)+4
pdf.dark_band(12,mby,186,44)
pdf.set_font("Helvetica","B",13); pdf.set_text_color(*WHITE)
pdf.set_xy(20,mby+6); pdf.cell(0,7,"Built for Multilingual India")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(148,163,184)
pdf.set_xy(20,mby+14)
pdf.multi_cell(170,5,
    "SnapServe is purpose-built for the Indian market. Your agents can speak and understand Hindi, Tamil, "
    "Telugu, Malayalam, Kannada, Marathi, Bengali and English - switching languages mid-call based on caller preference.")
langs=["Hindi","Tamil","Telugu","Malayalam","Kannada","English","+ more"]
lx=20
for lang in langs:
    pdf.set_font("Helvetica","B",7)
    tw=pdf.get_string_width(lang)+10
    pdf.fr(lx,mby+32,tw,7,40,40,70)
    pdf.set_text_color(203,213,225)
    pdf.set_xy(lx,mby+32.5); pdf.cell(tw,6,lang,align="C")
    lx+=tw+4
pdf.footer_bar()


# PAGE 5 - PRICING
pdf.add_page()
pdf.header_bar(5)
pdf.eyebrow(12,22,"Pricing")
pdf.stitle(12,29,"Simple, Transparent Pricing")
pdf.body(12,40,186,"Two plans. No hidden fees. No per-seat charges. Pay only for what your agents actually use.")

pdf.frd(12,56,88,110,*LBG,*BORDER)
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*BRAND)
pdf.set_xy(20,63); pdf.cell(0,5,"MANAGED PLAN")
pdf.set_font("Helvetica","B",28); pdf.set_text_color(*TEXT)
pdf.set_xy(20,70); pdf.cell(0,12,"$0.05")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(*MUTED)
pdf.set_xy(20,83); pdf.cell(0,5,"per minute - all-inclusive")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(55,65,81)
pdf.set_xy(20,91); pdf.multi_cell(72,5,"We supply all AI provider keys - ASR, LLM and TTS. You just configure your agents and go live. Zero friction.")
feats_m=["All AI providers included","No API keys to manage","Instant activation",
         "Full platform features","Caller memory & analytics","Scheduling & campaigns","$5 free credits on sign-up"]
fy=117
for f in feats_m:
    pdf.set_font("Helvetica","B",8); pdf.set_text_color(*ACCENT)
    pdf.set_xy(20,fy); pdf.cell(6,5,"v ")
    pdf.set_font("Helvetica","",8); pdf.set_text_color(*TEXT)
    pdf.set_xy(26,fy); pdf.cell(0,5,f)
    fy+=6.5

pdf.fr(110,56,88,110,*DARK2)
pdf.set_draw_color(*BRAND); pdf.rect(110,56,88,110,"D")
pdf.fr(156,56,42,8,*ACCENT)
pdf.set_font("Helvetica","B",6); pdf.set_text_color(*WHITE)
pdf.set_xy(156,57); pdf.cell(42,6,"MOST POPULAR",align="C")
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*ACCENT)
pdf.set_xy(118,67); pdf.cell(0,5,"BYOP PLAN")
pdf.set_font("Helvetica","B",28); pdf.set_text_color(*WHITE)
pdf.set_xy(118,74); pdf.cell(0,12,"$0.035")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(*MUTED)
pdf.set_xy(118,87); pdf.cell(0,5,"per minute - orchestration only")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(148,163,184)
pdf.set_xy(118,95); pdf.multi_cell(72,5,"Bring your own API keys. Pay SnapServe only for orchestration. Best for high-volume deployments.")
feats_b=["Use your own provider keys","Lower per-minute cost","Choose any supported provider",
         "Full platform features","Caller memory & analytics","Scheduling & campaigns","Ideal for high-volume"]
fy=119
for f in feats_b:
    pdf.set_font("Helvetica","B",8); pdf.set_text_color(*ACCENT)
    pdf.set_xy(118,fy); pdf.cell(6,5,"v ")
    pdf.set_font("Helvetica","",8); pdf.set_text_color(203,213,225)
    pdf.set_xy(124,fy); pdf.cell(0,5,f)
    fy+=6.5

pdf.frd(12,174,186,48,*LBG,*BORDER)
pdf.set_font("Helvetica","B",10); pdf.set_text_color(*TEXT)
pdf.set_xy(20,180); pdf.cell(0,5,"Which plan is right for you?")
m_tips=["Just getting started","Don't want to manage API keys","Low to medium call volume","Want fastest go-live"]
b_tips=["High call volumes (1000+ min/day)","Have existing provider contracts","Want to optimise per-minute cost","Need a specific provider voice"]
pdf.set_font("Helvetica","B",8); pdf.set_text_color(*BRAND)
pdf.set_xy(20,188); pdf.cell(0,5,"Choose Managed if...")
pdf.set_font("Helvetica","B",8); pdf.set_text_color(*ACCENT)
pdf.set_xy(113,188); pdf.cell(0,5,"Choose BYOP if...")
for ti,tip in enumerate(m_tips):
    pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
    pdf.set_xy(20,195+ti*5.5); pdf.cell(0,5,"- "+tip)
for ti,tip in enumerate(b_tips):
    pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
    pdf.set_xy(113,195+ti*5.5); pdf.cell(0,5,"- "+tip)

pdf.frd(12,228,186,22,240,253,244,167,243,208)
pdf.set_font("Helvetica","B",9.5); pdf.set_text_color(*ACCENT)
pdf.set_xy(20,234); pdf.cell(0,5,"Free Trial:  $5 of call credits (~100 minutes) on every new account. No credit card required.")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(55,65,81)
pdf.set_xy(20,241); pdf.cell(0,5,"Top up your wallet at any time. Cancel or change plans whenever you like.")
pdf.footer_bar()


# PAGE 6 - PROVIDERS & COMPARISON
pdf.add_page()
pdf.header_bar(6)
pdf.eyebrow(12,22,"Integrations")
pdf.stitle(12,29,"Supported Providers")

prov=[
    ("Speech-to-Text (ASR)",BRAND,  [(108,99,255),"Deepgram","Azure Speech","OpenAI Whisper","Sarvam AI"]),
    ("LLM Models",          ACCENT, [(16,185,129),"OpenAI GPT-4o","Anthropic Claude","DeepSeek","Mistral","Cohere"]),
    ("Text-to-Speech (TTS)",ORANGE, [(245,158,11),"ElevenLabs","OpenAI TTS","AWS Polly","Azure Neural","Cartesia","Deepgram Aura"]),
    ("Telephony",           RED,    [(239,68,68),"Twilio","Plivo","VoBiz","Vonage"]),
]
py=42
for sec_t,_,chips in prov:
    pdf.set_font("Helvetica","B",8); pdf.set_text_color(*MUTED)
    pdf.set_xy(12,py); pdf.cell(0,5,sec_t.upper())
    py+=7
    dot_c=chips[0]; labels=chips[1:]
    cx_c=12
    for label in labels:
        pdf.set_font("Helvetica","B",8)
        tw=pdf.get_string_width(label)+16
        pdf.frd(cx_c,py,tw,8,*LBG,*BORDER)
        pdf.set_fill_color(*dot_c); pdf.set_draw_color(*dot_c)
        pdf.ellipse(cx_c+4,py+2.7,2.8,2.8,"F")
        pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*TEXT)
        pdf.set_xy(cx_c+9,py+0.8); pdf.cell(tw-10,6.5,label)
        cx_c+=tw+4
        if cx_c>175: cx_c=12; py+=10
    py+=14

pdf.eyebrow(12,py,"Comparison"); py+=7
pdf.set_font("Helvetica","B",13); pdf.set_text_color(*TEXT)
pdf.set_xy(12,py); pdf.cell(0,7,"SnapServe vs. Alternatives"); py+=10

cols_w=[68,32,32,32,22]
hdrs=["Feature","SnapServe","Vapi","Bolna","Custom"]
hx=12
for hi,(hdr,hw) in enumerate(zip(hdrs,cols_w)):
    bg=BRAND if hi==1 else (248,250,252)
    tc=WHITE if hi==1 else TEXT
    pdf.set_fill_color(*bg); pdf.set_draw_color(*BORDER)
    pdf.rect(hx,py,hw,9,"FD")
    pdf.set_font("Helvetica","B",8); pdf.set_text_color(*tc)
    pdf.set_xy(hx+2,py+1.5); pdf.cell(hw-4,6,hdr,align="C" if hi>0 else "L")
    hx+=hw

rows=[
    ("Multilingual Indic",  "Yes - Full","Limited","Yes","DIY"),
    ("Caller memory",       "Yes - Built-in","No","No","DIY"),
    ("Campaign dialing",    "Yes - Built-in","Basic","No","DIY"),
    ("Scheduling/Booking",  "Yes - Full engine","No","No","DIY"),
    ("BYOP provider keys",  "Yes - Any provider","Yes","Yes","Yes"),
    ("Web-call (browser)",  "Yes","Yes","No","DIY"),
    ("Setup time",          "< 10 min","< 10 min","Hours","Weeks"),
    ("India-first pricing", "$0.05/min","$0.05+/min","Variable","High"),
]
py+=9
for ri,row in enumerate(rows):
    bg=(250,250,255) if ri%2==0 else WHITE
    hx2=12
    for ci,(cell,cw) in enumerate(zip(row,cols_w)):
        cbg=(245,243,255) if ci==1 else bg
        pdf.set_fill_color(*cbg); pdf.set_draw_color(*BORDER)
        pdf.rect(hx2,py,cw,8,"FD")
        if ci==1: tc=BRAND
        elif cell.startswith("Yes"): tc=ACCENT
        elif cell=="No": tc=RED
        else: tc=TEXT
        pdf.set_font("Helvetica","B" if ci<=1 else "",7.5); pdf.set_text_color(*tc)
        pdf.set_xy(hx2+2,py+1.2); pdf.cell(cw-4,5.5,cell,align="C" if ci>0 else "L")
        hx2+=cw
    py+=8
pdf.footer_bar()


# PAGE 7 - GET STARTED & CONTACT
pdf.add_page()
pdf.header_bar(7)
pdf.eyebrow(12,22,"Key Features")
pdf.stitle(12,29,"Everything You Need, Out of the Box")

mini=[
    ("MEM","Caller Memory","Persistent facts and history per caller. Never asks the same question twice."),
    ("ANL","Analytics","Real-time call volume, success rates, duration trends and cost per call."),
    ("CMP","Campaigns","Upload a lead list, set concurrency, let your agent dial. Retry logic built-in."),
    ("WHK","Webhooks & CRM","Push call events, transcripts and outcomes to any CRM or endpoint in real time."),
    ("TRF","Warm Transfers","Agent hands off to a human with a live spoken briefing before connection."),
    ("WEB","Web Call Widget","Embed a browser-based call widget on your website - no phone number needed."),
]
fx,fy2,fw,fh=12,44,58,42
for i,(ico,title,desc) in enumerate(mini):
    col=i%3; row=i//3
    cx=fx+col*(fw+4); cy=fy2+row*(fh+4)
    pdf.frd(cx,cy,fw,fh,*LBG,*BORDER)
    pdf.fr(cx+fw/2-6,cy+4,12,10,*BORDER)
    pdf.set_font("Helvetica","B",6); pdf.set_text_color(*BRAND)
    pdf.set_xy(cx+fw/2-6,cy+5.5); pdf.cell(12,7,ico,align="C")
    pdf.set_font("Helvetica","B",8); pdf.set_text_color(*TEXT)
    pdf.set_xy(cx+3,cy+16); pdf.cell(fw-6,5,title)
    pdf.set_font("Helvetica","",7); pdf.set_text_color(*MUTED)
    pdf.set_xy(cx+3,cy+22); pdf.multi_cell(fw-6,4.3,desc)

cta_y=fy2+2*(fh+4)+6
pdf.dark_band(12,cta_y,186,64)
pdf.set_font("Helvetica","B",8); pdf.set_text_color(*BRAND)
pdf.set_xy(20,cta_y+8); pdf.cell(170,5,"GET STARTED TODAY",align="C")
pdf.set_font("Helvetica","B",15); pdf.set_text_color(*WHITE)
pdf.set_xy(20,cta_y+16); pdf.cell(170,8,"Ready to Deploy Your First AI Voice Agent?",align="C")
pdf.set_font("Helvetica","",9); pdf.set_text_color(148,163,184)
pdf.set_xy(30,cta_y+27)
pdf.multi_cell(150,5,
    "Sign up in under 2 minutes. No credit card required. Get $5 free credits "
    "and have your first agent live in under 10 minutes.")

pdf.fr(42,cta_y+44,56,12,*BRAND)
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*WHITE)
pdf.set_xy(42,cta_y+45); pdf.cell(56,10,"Start Free Trial",align="C")
pdf.fr(106,cta_y+44,56,12,40,40,70)
pdf.set_draw_color(80,80,120); pdf.rect(106,cta_y+44,56,12,"D")
pdf.set_font("Helvetica","B",9); pdf.set_text_color(203,213,225)
pdf.set_xy(106,cta_y+45); pdf.cell(56,10,"Book a Demo",align="C")

ct_y=cta_y+76
contacts=[("Platform","snapserve.ai"),("Support","support@snapserve.ai"),
          ("Sales","sales@snapserve.ai"),("Documentation","docs.snapserve.ai")]
cx_ct=12
for lbl,val in contacts:
    pdf.frd(cx_ct,ct_y,44,20,*LBG,*BORDER)
    pdf.set_font("Helvetica","B",7); pdf.set_text_color(*MUTED)
    pdf.set_xy(cx_ct+4,ct_y+4); pdf.cell(36,5,lbl.upper())
    pdf.set_font("Helvetica","B",8.5); pdf.set_text_color(*TEXT)
    pdf.set_xy(cx_ct+4,ct_y+11); pdf.cell(36,6,val)
    cx_ct+=48

pdf.footer_bar()

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
pdf.output(OUTPUT)
print(f"Brochure saved -> {OUTPUT}")
