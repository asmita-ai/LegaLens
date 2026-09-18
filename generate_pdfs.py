from fpdf import FPDF

def create_employment():
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=12)
    text = """EMPLOYMENT OFFER LETTER

1. Offer of Employment
We are pleased to offer you the position of Software Engineer.

2. Notice Period
Either party may terminate this agreement by providing 60 days of written notice.

3. Non-Compete
For a period of one year following the termination of employment, you agree not to work for any direct competitor in the same geographic region.

4. Service Bond
The employee agrees to a minimum service period of 12 months. If the employee resigns before this period, they are liable to pay a penalty of INR 100000.

5. Confidentiality
You must keep all company information strictly confidential.
"""
    for line in text.split('\n'):
        pdf.multi_cell(0, 10, txt=line)
    pdf.output("employment_offer.pdf")

def create_rental():
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=12)
    text = """RESIDENTIAL RENTAL AGREEMENT

1. Property details
This agreement is for the residential property located at 123 Main Street.

2. Rent
The monthly rent is INR 25000, payable by the 5th of every month.

3. Security Deposit
A refundable security deposit of INR 75000 must be paid upon signing.

4. Notice Period
The tenant must provide a 30-day notice period before vacating the premises.

5. Maintenance
The tenant is responsible for regular upkeep and minor repairs.
"""
    for line in text.split('\n'):
        pdf.multi_cell(0, 10, txt=line)
    pdf.output("rental_agreement.pdf")

create_employment()
create_rental()
