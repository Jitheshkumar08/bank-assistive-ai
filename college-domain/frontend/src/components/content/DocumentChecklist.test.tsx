import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithRouter } from '../../test/renderWithRouter'

const rowTitles = () => within(screen.getByRole('tabpanel')).getAllByRole('button').map((button) => button.querySelector('.checklist__title')?.textContent)

describe('Required Documents', () => {
  it('is available before any QR scan', async () => {
    renderWithRouter({ path: '/documents', collegeContext: null })
    expect(await screen.findByRole('heading', { name: 'Required Documents' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    expect(rowTitles()).toHaveLength(6)
  })

  it('filters by category with the tabs, including arrow-key navigation', async () => {
    const user = userEvent.setup()
    renderWithRouter({ path: '/documents' })
    await user.click(await screen.findByRole('tab', { name: 'Academic' }))
    expect(screen.getByRole('tab', { name: 'Academic' })).toHaveAttribute('aria-selected', 'true')
    expect(rowTitles()).toEqual(['PUC / 10+2 marks card', 'Qualifying examination certificate'])
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Category' })).toHaveFocus()
    expect(rowTitles()).toEqual(['Category certificate (if applicable)'])
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
  })

  it('expands a row to show details, marks it provisional and tracks readiness', async () => {
    const user = userEvent.setup()
    renderWithRouter({ path: '/documents' })
    const row = await screen.findByRole('button', { name: /Identity proof/ })
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Provisional example')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'I have this document ready' }))
    expect(screen.getByText(/1 of 6 marked ready/)).toBeInTheDocument()
    expect(within(row).getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText(/not saved yet/)).toBeInTheDocument()
  })

  it('opens the item linked from search', async () => {
    renderWithRouter({ path: '/documents#nucat' })
    expect(await screen.findByRole('button', { name: /NUCAT application details/ })).toHaveAttribute('aria-expanded', 'true')
  })
})
