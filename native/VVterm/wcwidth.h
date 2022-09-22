#ifndef wcwidth_h
#define wcwidth_h

int mk_wcwidth(unsigned int ucs);
int mk_wcswidth(const unsigned int *pwcs, size_t n);

#endif
