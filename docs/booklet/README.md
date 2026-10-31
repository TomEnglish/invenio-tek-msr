# Field guide booklet

`booklet.html` is the text of the Invenio Field Platform field guide, `booklet.css` its print style, `diagrams/` its figures and `images/` the Kindred and Invenio logos. Build the PDF with:

    python3 scripts/build-booklet.py

It needs Google Chrome (set `CHROME` to its path if it isn't in `/Applications`) and, for the page numbers in the contents, poppler's `pdftotext`. The PDF is written to `docs/booklet/Invenio-Field-Platform-booklet.pdf`, which is not committed.

When the software changes, update the text, the edition lines on the cover and the revision history (appendix A11), and keep the contents to one page.
