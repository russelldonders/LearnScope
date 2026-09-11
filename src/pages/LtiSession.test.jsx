import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LtiSession from './LtiSession'
import { ltiRequest } from '../lib/lti/session'
const auth=vi.hoisted(()=>({user:{id:'one',email:'learner@example.com'},loading:false,needsName:false,needsOnboarding:false}))
vi.mock('../context/AuthContext',()=>({useAuth:()=>auth}))
vi.mock('../lib/lti/session',()=>({ltiRequest:vi.fn()}))
vi.mock('./SkillDetail',()=>({default:({skillId})=><div>Personal skill {skillId}</div>}))
afterEach(cleanup)
beforeEach(()=>{vi.clearAllMocks();auth.user={id:'one',email:'learner@example.com'};sessionStorage.clear()})
const renderPage=()=>render(<MemoryRouter><LtiSession/></MemoryRouter>)
it('does not open private skill details before account linking',async()=>{ltiRequest.mockResolvedValue({type:'learner',title:'SQL',linkRequired:true,lms:'Test LMS'});renderPage();expect(await screen.findByRole('button',{name:'Connect my account'})).toBeVisible();expect(screen.queryByText(/Personal skill/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Connect my account'}));expect(ltiRequest).toHaveBeenCalledWith('link',{confirm:true})})
it('shows login without creating an LMS-based LearnScope session',async()=>{auth.user=null;ltiRequest.mockResolvedValue({type:'learner',title:'SQL',loginRequired:true});renderPage();expect(await screen.findByRole('link',{name:'Sign in or create an account'})).toHaveAttribute('href','/login')})
it('requires a separate explicit grade consent',async()=>{ltiRequest.mockResolvedValue({type:'learner',title:'SQL',skillId:'own',canGrade:true,consent:false});renderPage();const box=await screen.findByRole('checkbox');expect(box).not.toBeChecked();expect(screen.getByText('Personal skill own')).toBeVisible();fireEvent.click(box);expect(ltiRequest).toHaveBeenCalledWith('consent',{consent:true})})
it('offers skill creation only after linking',async()=>{ltiRequest.mockResolvedValue({type:'learner',title:'SQL',canGrade:false});renderPage();fireEvent.click(await screen.findByRole('button',{name:'Add to my skills'}));expect(ltiRequest).toHaveBeenCalledWith('add',undefined)})
it('shows only objects returned by the authorised LMS picker',async()=>{ltiRequest.mockResolvedValue({type:'picker',objects:[{id:'object',title:'SQL'}]});renderPage();expect(await screen.findByRole('button',{name:'Select SQL'})).toBeVisible();expect(screen.queryByRole('checkbox')).toBeNull()})
it('keeps launch errors visible without falling through to a skill',async()=>{ltiRequest.mockRejectedValue(new Error('Launch expired'));renderPage();expect(await screen.findByRole('alert')).toHaveTextContent('Launch expired');expect(screen.queryByText(/Personal skill/)).toBeNull()})

it('clears the prior learner’s skill when the signed-in account changes',async()=>{ltiRequest.mockResolvedValueOnce({type:'learner',title:'SQL',skillId:'first-account',canGrade:false});const rendered=renderPage();expect(await screen.findByText('Personal skill first-account')).toBeVisible();auth.user={id:'two'};ltiRequest.mockRejectedValue(new Error('This LMS identity is linked to a different account.'));rendered.rerender(<MemoryRouter><LtiSession/></MemoryRouter>);expect(screen.queryByText('Personal skill first-account')).toBeNull();expect(await screen.findByRole('alert')).toHaveTextContent('different account')})
